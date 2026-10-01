// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import { ThematicBasket } from "./ThematicBasket.sol";
import { BasketMath } from "./libraries/BasketMath.sol";
import { IBasketFactory } from "./interfaces/IBasketFactory.sol";

/// @title BasketFactory
/// @notice Deploys thematic baskets and keeps the registry the frontend reads.
///
/// @dev Authority model
/// -------------------
/// The factory's administrator can change infrastructure (price provider, DEX
/// adapter, treasury), fee ceilings and the component allowlist. **Every one of
/// those changes applies only to baskets created afterwards.** Once a basket
/// exists, its composition, fees, provider and adapter are immutable and the
/// admin has no path to them. This is the whole point of the split: an investor
/// reading a basket's parameters on-chain at deposit time can rely on them for
/// as long as they hold.
///
/// The factory never holds user funds and cannot move any.
contract BasketFactory is IBasketFactory {
    /// @notice Hard ceiling on every basket's deposit fee, mirroring the cap in
    ///         {ThematicBasket}. The factory's own ceiling can only lower it.
    uint16 public constant ABSOLUTE_MAX_FEE_BPS = 200; // 2%
    uint16 public constant ABSOLUTE_MAX_CREATOR_SHARE_BPS = 9_000; // protocol keeps >= 10%
    uint16 public constant ABSOLUTE_MAX_SLIPPAGE_BPS = 1_000; // 10%

    /// @notice Most components a basket may hold.
    /// @dev Exposed so a creation interface can enforce the same limit the
    ///      factory does, rather than restating the number and drifting from it.
    ///      The value lives in {BasketMath} and is the only definition.
    uint256 public constant MAX_COMPONENTS = BasketMath.MAX_COMPONENTS;

    /// @notice Settlement asset every basket deployed here uses.
    address public immutable settlementToken;

    /// @notice Protocol administrator.
    address public immutable protocolAdmin;

    /// @notice Ceilings applied to baskets created from now on.
    uint16 public maxDepositFeeBps;
    uint16 public maxRedeemFeeBps;
    uint16 public maxCreatorShareBps;
    uint16 public maxSlippageBps;

    /// @notice Fee parameters suggested to creators and used by the deploy
    ///         scripts. Advisory only — a creator may pass anything within the
    ///         ceilings above.
    uint16 public defaultDepositFeeBps;
    uint16 public defaultRedeemFeeBps;
    uint16 public defaultCreatorShareBps;
    uint16 public defaultMaxSlippageBps;

    /// @notice Valuation source copied into baskets created from now on.
    address public priceProvider;
    /// @notice Swap venue copied into baskets created from now on.
    address public dexAdapter;
    /// @notice Recipient of the protocol's fee share for baskets created from
    ///         now on.
    address public protocolTreasury;

    /// @notice When true, a component must be allowlisted to be used.
    /// @dev Off by default. It exists because tokenized equities on BSC are a
    ///      young, permissioned category: a basket built on a token with no real
    ///      claim behind it is a way to lose other people's money, and the
    ///      protocol would rather gate that at creation than explain it later.
    bool public allowlistEnforced;

    address[] private _baskets;
    mapping(address basket => bool known) private _isBasket;
    mapping(address creator => address[] baskets) private _basketsByCreator;
    mapping(address component => bool allowed) public isComponentAllowed;

    error ZeroAddress(string field);
    error AddressHasNoCode(string field, address account);
    error NotProtocolAdmin(address caller);
    error FeeTooHigh(string field, uint16 provided, uint16 maximum);
    error ComponentNotAllowed(address component);
    error SettlementTokenIsComponent(address component);
    error InvalidName();

    // Restated from {BasketMath} so they appear in this contract's ABI, where a
    // frontend decoding a reverted creation will look for them. The selectors are
    // identical to the library's.
    error WeightLengthMismatch(uint256 components, uint256 weights);
    error NoComponents();
    error TooManyComponents(uint256 provided, uint256 maximum);
    error ZeroComponentAddress(uint256 index);
    error DuplicateComponent(address component);
    error ZeroWeight(uint256 index);
    error InvalidWeightTotal(uint256 total, uint256 expected);
    error ComponentDecimalsTooHigh(address component, uint8 decimals);
    error ComponentNotERC20Metadata(address component);

    /// @param settlementToken_ Settlement asset for every basket. Must be a
    ///        contract; its decimals are read once at construction so a basket
    ///        can cache them without a second external call.
    /// @param protocolAdmin_ Administrator. Expected to be a multisig or a
    ///        timelocked account on mainnet — see `docs/SECURITY.md`.
    /// @param priceProvider_ Initial valuation source.
    /// @param dexAdapter_ Initial swap venue.
    /// @param protocolTreasury_ Initial protocol fee recipient.
    /// @param defaults_ Initial default fee parameters:
    ///        `[depositFeeBps, redeemFeeBps, creatorShareBps, maxSlippageBps]`.
    constructor(
        address settlementToken_,
        address protocolAdmin_,
        address priceProvider_,
        address dexAdapter_,
        address protocolTreasury_,
        uint16[4] memory defaults_
    ) {
        _requireContract(settlementToken_, "settlementToken");
        _requireAccount(protocolAdmin_, "protocolAdmin");
        _requireContract(priceProvider_, "priceProvider");
        _requireContract(dexAdapter_, "dexAdapter");
        _requireAccount(protocolTreasury_, "protocolTreasury");

        settlementToken = settlementToken_;
        protocolAdmin = protocolAdmin_;
        priceProvider = priceProvider_;
        dexAdapter = dexAdapter_;
        protocolTreasury = protocolTreasury_;

        // Ceilings start at the absolute maximum; the admin can only tighten.
        maxDepositFeeBps = ABSOLUTE_MAX_FEE_BPS;
        maxRedeemFeeBps = ABSOLUTE_MAX_FEE_BPS;
        maxCreatorShareBps = ABSOLUTE_MAX_CREATOR_SHARE_BPS;
        maxSlippageBps = ABSOLUTE_MAX_SLIPPAGE_BPS;

        _setDefaults(defaults_);
    }

    // ---------------------------------------------------------------------
    // Creation
    // ---------------------------------------------------------------------

    /// @inheritdoc IBasketFactory
    function createBasket(CreateBasketParams calldata params) external returns (address basket) {
        if (bytes(params.name).length == 0) revert InvalidName();

        _checkFee("depositFeeBps", params.depositFeeBps, maxDepositFeeBps);
        _checkFee("redeemFeeBps", params.redeemFeeBps, maxRedeemFeeBps);
        _checkFee("creatorShareBps", params.creatorShareBps, maxCreatorShareBps);
        _checkFee("maxSlippageBps", params.maxSlippageBps, maxSlippageBps);

        // Same validation the basket runs on itself. Duplicated deliberately:
        // the factory reverts with a clear error before spending deployment gas,
        // and the basket stays safe even if it is deployed directly.
        BasketMath.validateComposition(
            params.components,
            params.weightsBps,
            BasketMath.MAX_COMPONENTS
        );

        uint256 length = params.components.length;
        for (uint256 i; i < length; ++i) {
            address component = params.components[i];
            if (component == settlementToken) revert SettlementTokenIsComponent(component);
            if (allowlistEnforced && !isComponentAllowed[component]) {
                revert ComponentNotAllowed(component);
            }
        }

        ThematicBasket.BasketConfig memory config = ThematicBasket.BasketConfig({
            settlementToken: settlementToken,
            priceProvider: priceProvider,
            dexAdapter: dexAdapter,
            creator: params.creator,
            protocolAdmin: protocolAdmin,
            protocolTreasury: protocolTreasury,
            depositFeeBps: params.depositFeeBps,
            redeemFeeBps: params.redeemFeeBps,
            creatorShareBps: params.creatorShareBps,
            maxSlippageBps: params.maxSlippageBps
        });

        basket = address(
            new ThematicBasket(
                params.name,
                params.symbol,
                params.description,
                params.theme,
                params.components,
                params.weightsBps,
                config
            )
        );

        _baskets.push(basket);
        _isBasket[basket] = true;
        _basketsByCreator[params.creator].push(basket);

        emit BasketCreated(
            basket,
            params.creator,
            params.name,
            params.symbol,
            params.theme,
            params.components,
            params.weightsBps
        );

        return basket;
    }

    // ---------------------------------------------------------------------
    // Administration — affects future baskets only
    // ---------------------------------------------------------------------

    /// @notice Sets the fee ceilings applied to baskets created from now on.
    /// @dev Ceilings can be tightened or loosened, but never past the absolute
    ///      caps baked into {ThematicBasket}. Existing baskets are untouched:
    ///      their parameters are immutable, which the frontend shows explicitly.
    function setCreationLimits(
        uint16 maxDepositFeeBps_,
        uint16 maxRedeemFeeBps_,
        uint16 maxCreatorShareBps_,
        uint16 maxSlippageBps_
    ) external onlyProtocolAdmin {
        _checkFee("maxDepositFeeBps", maxDepositFeeBps_, ABSOLUTE_MAX_FEE_BPS);
        _checkFee("maxRedeemFeeBps", maxRedeemFeeBps_, ABSOLUTE_MAX_FEE_BPS);
        _checkFee("maxCreatorShareBps", maxCreatorShareBps_, ABSOLUTE_MAX_CREATOR_SHARE_BPS);
        _checkFee("maxSlippageBps", maxSlippageBps_, ABSOLUTE_MAX_SLIPPAGE_BPS);

        maxDepositFeeBps = maxDepositFeeBps_;
        maxRedeemFeeBps = maxRedeemFeeBps_;
        maxCreatorShareBps = maxCreatorShareBps_;
        maxSlippageBps = maxSlippageBps_;

        emit CreationLimitsUpdated(
            maxDepositFeeBps_,
            maxRedeemFeeBps_,
            maxCreatorShareBps_,
            maxSlippageBps_
        );
    }

    /// @notice Sets the fee parameters suggested to creators.
    function setDefaultFees(uint16[4] calldata defaults) external onlyProtocolAdmin {
        _setDefaults(defaults);
    }

    /// @notice Points baskets created from now on at a new price provider and
    ///         DEX adapter.
    /// @dev A migration path, not a tuning knob. Existing baskets keep the
    ///      provider they were created with, so this can never be used to
    ///      reprice a live basket.
    function setInfrastructure(
        address priceProvider_,
        address dexAdapter_
    ) external onlyProtocolAdmin {
        _requireContract(priceProvider_, "priceProvider");
        _requireContract(dexAdapter_, "dexAdapter");

        priceProvider = priceProvider_;
        dexAdapter = dexAdapter_;

        emit InfrastructureUpdated(priceProvider_, dexAdapter_);
    }

    /// @notice Sets the protocol fee recipient for baskets created from now on.
    function setProtocolTreasury(address protocolTreasury_) external onlyProtocolAdmin {
        _requireAccount(protocolTreasury_, "protocolTreasury");
        protocolTreasury = protocolTreasury_;
        emit ProtocolTreasuryUpdated(protocolTreasury_);
    }

    /// @notice Adds or removes a component from the allowlist.
    function setComponentAllowed(address component, bool allowed) external onlyProtocolAdmin {
        _requireContract(component, "component");
        if (component == settlementToken) revert SettlementTokenIsComponent(component);

        isComponentAllowed[component] = allowed;
        emit ComponentAllowlistUpdated(component, allowed);
    }

    /// @notice Enables or disables allowlist enforcement for new baskets.
    /// @dev Enforcement is a creation-time gate only. If it is switched off, every
    ///      already-created basket is unaffected — they were validated against the
    ///      rules in force when they were created.
    function setAllowlistEnforced(bool enforced) external onlyProtocolAdmin {
        allowlistEnforced = enforced;
        emit AllowlistEnforcementUpdated(enforced);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IBasketFactory
    function basketCount() external view returns (uint256) {
        return _baskets.length;
    }

    /// @inheritdoc IBasketFactory
    function basketAt(uint256 index) external view returns (address) {
        return _baskets[index];
    }

    /// @inheritdoc IBasketFactory
    function allBaskets() external view returns (address[] memory) {
        return _baskets;
    }

    /// @inheritdoc IBasketFactory
    function isBasket(address account) external view returns (bool) {
        return _isBasket[account];
    }

    /// @inheritdoc IBasketFactory
    function basketsByCreator(address creator) external view returns (address[] memory) {
        return _basketsByCreator[creator];
    }

    /// @notice Decimals of the settlement token, exposed so the frontend can
    ///         format amounts without an extra call per basket.
    function settlementDecimals() external view returns (uint8) {
        return IERC20Metadata(settlementToken).decimals();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _setDefaults(uint16[4] memory defaults) private {
        _checkFee("defaultDepositFeeBps", defaults[0], maxDepositFeeBps);
        _checkFee("defaultRedeemFeeBps", defaults[1], maxRedeemFeeBps);
        _checkFee("defaultCreatorShareBps", defaults[2], maxCreatorShareBps);
        _checkFee("defaultMaxSlippageBps", defaults[3], maxSlippageBps);

        defaultDepositFeeBps = defaults[0];
        defaultRedeemFeeBps = defaults[1];
        defaultCreatorShareBps = defaults[2];
        defaultMaxSlippageBps = defaults[3];

        emit DefaultFeesUpdated(defaults[0], defaults[1], defaults[2], defaults[3]);
    }

    function _checkFee(string memory field, uint16 provided, uint16 maximum) private pure {
        if (provided > maximum) revert FeeTooHigh(field, provided, maximum);
    }

    function _requireAccount(address account, string memory field) private pure {
        if (account == address(0)) revert ZeroAddress(field);
    }

    function _requireContract(address account, string memory field) private view {
        if (account == address(0)) revert ZeroAddress(field);
        if (account.code.length == 0) revert AddressHasNoCode(field, account);
    }

    modifier onlyProtocolAdmin() {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin(msg.sender);
        _;
    }
}
