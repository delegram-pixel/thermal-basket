// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BasketMath } from "./libraries/BasketMath.sol";
import { IPriceProvider } from "./interfaces/IPriceProvider.sol";
import { IDexAdapter } from "./interfaces/IDexAdapter.sol";
import { IThematicBasket } from "./interfaces/IThematicBasket.sol";

/// @title ThematicBasket
/// @notice A single thematic portfolio: an ERC-20 whose supply is backed by the
///         component tokens the contract actually holds.
///
/// @dev Economic model (MVP)
/// ------------------------
/// The basket is **fully collateralised**, not synthetic. A deposit of the
/// settlement token is charged a fee, swapped into the basket's components
/// through the configured DEX adapter, and retained by this contract. Basket
/// tokens are minted against the value actually received, priced at the price
/// provider's rate. Redemption is the exact reverse: the holder's pro-rata slice
/// of the real component balances is sold back into the settlement token and
/// paid out. There is no mechanism by which the contract promises value it does
/// not hold.
///
/// NAV per share therefore equals total component value plus unencumbered
/// settlement, divided by supply. It is derived from holdings and an external
/// price, never from a number supplied by a backend.
///
/// Access control
/// --------------
/// - **Holder** — `deposit`, `redeem`, `transfer` (via ERC-20). No privileges.
/// - **Creator** — `claimCreatorFees`. Cannot change the basket in any way: the
///   composition and fee parameters are fixed at construction, so a basket can
///   never be re-pointed at different assets or a higher fee after investors
///   have entered it.
/// - **Protocol admin** — `pause`, `unpause` and `withdrawProtocolFees`. Cannot
///   mint, cannot move holder assets, cannot alter composition or fees.
///
/// Known limitations are documented in `docs/ECONOMIC-MODEL.md` and
/// `docs/SECURITY.md`; read them before deploying to mainnet.
contract ThematicBasket is ERC20, ReentrancyGuard, Pausable, IThematicBasket {
    using SafeERC20 for IERC20;

    /// @notice Hard cap on components per basket. Mirrors the bound enforced by
    ///         the factory; see {BasketMath-MAX_COMPONENTS}.
    uint256 public constant MAX_COMPONENTS = BasketMath.MAX_COMPONENTS;

    /// @notice Caps on creation-time fee parameters. Enforced here as well as in
    ///         the factory: the factory is the only intended deployer, but a
    ///         basket should not depend on that being true.
    uint16 public constant MAX_DEPOSIT_FEE_BPS = 200; // 2%
    uint16 public constant MAX_REDEEM_FEE_BPS = 200; // 2%
    uint16 public constant MAX_CREATOR_SHARE_BPS = 9_000; // protocol keeps >= 10%
    uint16 public constant MAX_SLIPPAGE_BPS = 1_000; // 10%

    /// @dev Creation parameters, grouped to keep the constructor signature
    ///      readable and the stack shallow.
    struct BasketConfig {
        address settlementToken;
        address priceProvider;
        address dexAdapter;
        address creator;
        address protocolAdmin;
        address protocolTreasury;
        uint16 depositFeeBps;
        uint16 redeemFeeBps;
        uint16 creatorShareBps;
        uint16 maxSlippageBps;
    }

    /// @notice Settlement asset investors deposit and redeem into.
    address public immutable settlementToken;
    /// @notice Valuation source for every component.
    address public immutable priceProvider;
    /// @notice Venue every swap routes through.
    address public immutable dexAdapter;
    /// @notice Receives the creator's share of fees.
    address public immutable creator;
    /// @notice Address allowed to pause the basket and withdraw protocol fees.
    address public immutable protocolAdmin;
    /// @notice Receives the protocol's share of fees.
    address public immutable protocolTreasury;

    /// @notice Deposit fee in basis points, fixed at construction.
    uint16 public immutable depositFeeBps;
    /// @notice Redemption fee in basis points, fixed at construction. Zero on
    ///         every MVP basket, but implemented and capped rather than stubbed.
    uint16 public immutable redeemFeeBps;
    /// @notice Creator's share of collected fees, in basis points.
    uint16 public immutable creatorShareBps;
    /// @notice Per-swap slippage tolerance in basis points.
    uint16 public immutable maxSlippageBps;

    /// @notice Settlement token decimals, cached so previews need no external call.
    uint8 public immutable settlementDecimals;

    /// @notice Free-form thesis for the theme, fixed at construction.
    string public description;
    /// @notice Short theme label, fixed at construction.
    string public theme;

    address[] private _components;
    uint256[] private _weightsBps;
    uint8[] private _componentDecimals;

    /// @notice Fees earned by the creator and not yet claimed. Held in the
    ///         settlement token inside this contract and excluded from NAV, so
    ///         it never inflates the value of a basket token.
    uint256 public accruedCreatorFees;
    /// @notice Fees earned by the protocol and not yet withdrawn. Also excluded
    ///         from NAV.
    uint256 public accruedProtocolFees;

    error ZeroAddress(string field);
    error AddressHasNoCode(string field, address account);
    error FeeTooHigh(string field, uint16 provided, uint16 maximum);
    error ComponentIsSettlementToken(address component);
    error DeadlineExpired(uint256 timestamp, uint256 deadline);
    error ZeroAmount();
    error InsufficientShares(uint256 requested, uint256 available);
    error DepositSlippageExceeded(uint256 valueAdded, uint256 minimumValue);
    error InsufficientSharesOut(uint256 sharesOut, uint256 minSharesOut);
    error RedemptionSlippageExceeded(uint256 settlementOut, uint256 minSettlementOut);
    error RedemptionYieldsNothing(uint256 shares);
    error RedemptionTooSmall(address component);
    error DepositTooSmall(address component);
    error ComponentNotPriceable(address component);
    error UnsupportedSettlementToken(uint256 expected, uint256 received);
    error NotCreator(address caller);
    error NotProtocolAdmin(address caller);
    error NothingToClaim();

    // Composition errors originate in {BasketMath}. They are restated here
    // because a library's custom errors are not part of this contract's ABI, and
    // a frontend decoding a reverted deposit needs to be able to name the reason.
    // The selectors are identical either way.
    error WeightLengthMismatch(uint256 components, uint256 weights);
    error NoComponents();
    error TooManyComponents(uint256 provided, uint256 maximum);
    error ZeroComponentAddress(uint256 index);
    error DuplicateComponent(address component);
    error ZeroWeight(uint256 index);
    error InvalidWeightTotal(uint256 total, uint256 expected);
    error ComponentDecimalsTooHigh(address component, uint8 decimals);
    error ComponentNotERC20Metadata(address component);

    /// @param name_ Basket token name, e.g. "AI Winners Basket".
    /// @param symbol_ Basket token symbol, e.g. "AIWB".
    /// @param description_ Thesis text. Stored verbatim; not interpreted.
    /// @param theme_ Short theme label.
    /// @param components_ Component token addresses.
    /// @param weightsBps_ Component weights in basis points, summing to 10 000.
    /// @param config_ Remaining creation parameters.
    constructor(
        string memory name_,
        string memory symbol_,
        string memory description_,
        string memory theme_,
        address[] memory components_,
        uint256[] memory weightsBps_,
        BasketConfig memory config_
    ) ERC20(name_, symbol_) {
        _requireContract(config_.settlementToken, "settlementToken");
        _requireContract(config_.priceProvider, "priceProvider");
        _requireContract(config_.dexAdapter, "dexAdapter");
        _requireAccount(config_.creator, "creator");
        _requireAccount(config_.protocolAdmin, "protocolAdmin");
        _requireAccount(config_.protocolTreasury, "protocolTreasury");

        if (config_.depositFeeBps > MAX_DEPOSIT_FEE_BPS) {
            revert FeeTooHigh("depositFeeBps", config_.depositFeeBps, MAX_DEPOSIT_FEE_BPS);
        }
        if (config_.redeemFeeBps > MAX_REDEEM_FEE_BPS) {
            revert FeeTooHigh("redeemFeeBps", config_.redeemFeeBps, MAX_REDEEM_FEE_BPS);
        }
        if (config_.creatorShareBps > MAX_CREATOR_SHARE_BPS) {
            revert FeeTooHigh("creatorShareBps", config_.creatorShareBps, MAX_CREATOR_SHARE_BPS);
        }
        if (config_.maxSlippageBps > MAX_SLIPPAGE_BPS) {
            revert FeeTooHigh("maxSlippageBps", config_.maxSlippageBps, MAX_SLIPPAGE_BPS);
        }

        BasketMath.validateComposition(components_, weightsBps_, MAX_COMPONENTS);

        // Snapshot decimals once. Reading them per-operation would let a
        // component change its decimals mid-flight and shift every valuation.
        uint256 length = components_.length;
        for (uint256 i; i < length; ++i) {
            address component = components_[i];
            if (component == config_.settlementToken) {
                revert ComponentIsSettlementToken(component);
            }
            _components.push(component);
            _weightsBps.push(weightsBps_[i]);
            _componentDecimals.push(BasketMath.readDecimals(component));
        }

        settlementToken = config_.settlementToken;
        priceProvider = config_.priceProvider;
        dexAdapter = config_.dexAdapter;
        creator = config_.creator;
        protocolAdmin = config_.protocolAdmin;
        protocolTreasury = config_.protocolTreasury;
        depositFeeBps = config_.depositFeeBps;
        redeemFeeBps = config_.redeemFeeBps;
        creatorShareBps = config_.creatorShareBps;
        maxSlippageBps = config_.maxSlippageBps;
        settlementDecimals = IERC20Metadata(config_.settlementToken).decimals();
        description = description_;
        theme = theme_;
    }

    // ---------------------------------------------------------------------
    // Holder actions
    // ---------------------------------------------------------------------

    /// @notice Invests `amountIn` of the settlement token into the basket and
    ///         mints basket tokens against the value actually acquired.
    /// @param amountIn Settlement tokens to invest. The caller must have
    ///        approved this contract for at least this amount beforehand.
    /// @param minSharesOut Reverts if fewer basket tokens would be minted. The
    ///        caller's protection against a deposit landing at a worse price
    ///        than they were quoted.
    /// @param deadline Unix timestamp after which the deposit is invalid.
    /// @return sharesOut Basket tokens minted.
    function deposit(
        uint256 amountIn,
        uint256 minSharesOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);
        if (amountIn == 0) revert ZeroAmount();

        // Measure the basket before this deposit's assets arrive: minting is
        // priced against the pre-deposit state.
        uint256 totalAssetsBefore = totalAssets();
        uint256 supplyBefore = totalSupply();

        uint256 received = _pullSettlement(msg.sender, amountIn);

        (uint256 creatorFee, uint256 protocolFee, uint256 netInvested) = _accrueFee(
            received,
            depositFeeBps
        );
        emit FeesAccrued(msg.sender, creatorFee, protocolFee);

        uint256 valueAdded = _buyComponents(netInvested, deadline);

        // The swaps must have delivered assets worth at least what is being
        // minted against, within the basket's slippage tolerance. Without this a
        // sandwich or a thin pool could mint shares against value the basket
        // never received, diluting every existing holder.
        uint256 minimumValue = Math.mulDiv(
            netInvested,
            BasketMath.BPS_DENOMINATOR - maxSlippageBps,
            BasketMath.BPS_DENOMINATOR
        );
        if (valueAdded < minimumValue) {
            revert DepositSlippageExceeded(valueAdded, minimumValue);
        }

        sharesOut = BasketMath.sharesForDeposit(
            valueAdded,
            totalAssetsBefore,
            supplyBefore,
            settlementScale()
        );
        if (sharesOut == 0) revert ZeroAmount();
        if (sharesOut < minSharesOut) revert InsufficientSharesOut(sharesOut, minSharesOut);

        _mint(msg.sender, sharesOut);

        emit Deposit(msg.sender, amountIn, netInvested, sharesOut);
    }

    /// @notice Redeems basket tokens for the settlement token.
    /// @dev Sells the holder's pro-rata slice of the real component balances, so
    ///      the payout reflects what the basket actually holds rather than a
    ///      notional figure.
    /// @param shares Basket tokens to burn.
    /// @param minSettlementOut Reverts if the payout would be lower. Slippage
    ///        protection across every swap in the redemption.
    /// @param deadline Unix timestamp after which the redemption is invalid.
    /// @return settlementOut Settlement tokens paid to the caller, net of fees.
    function redeem(
        uint256 shares,
        uint256 minSettlementOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 settlementOut) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);
        if (shares == 0) revert ZeroAmount();

        uint256 supply = totalSupply();
        uint256 balance = balanceOf(msg.sender);
        if (shares > balance) revert InsufficientShares(shares, balance);

        // Snapshot every pro-rata claim before anything moves. Balances and
        // supply are read pre-burn so the slice is computed against the state
        // the holder actually owns a fraction of.
        uint256 length = _components.length;
        uint256[] memory componentAmounts = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            componentAmounts[i] = BasketMath.proRata(
                IERC20(_components[i]).balanceOf(address(this)),
                shares,
                supply
            );
        }
        uint256 settlementShare = BasketMath.proRata(freeSettlementBalance(), shares, supply);

        _burn(msg.sender, shares);

        uint256 gross = settlementShare + _sellComponents(componentAmounts, deadline);

        (uint256 creatorFee, uint256 protocolFee, uint256 net) = _accrueFee(gross, redeemFeeBps);
        emit FeesAccrued(msg.sender, creatorFee, protocolFee);

        // Burning shares for nothing is a loss the holder cannot see coming, so
        // it reverts instead of succeeding quietly. Reachable only with a dust
        // holding, but "you get nothing" is not an outcome worth allowing.
        if (net == 0) revert RedemptionYieldsNothing(shares);
        if (net < minSettlementOut) revert RedemptionSlippageExceeded(net, minSettlementOut);

        IERC20(settlementToken).safeTransfer(msg.sender, net);

        emit Redeem(msg.sender, shares, gross, net);
        return net;
    }

    // ---------------------------------------------------------------------
    // Creator
    // ---------------------------------------------------------------------

    /// @notice Withdraws the creator's accrued share of fees.
    /// @dev Callable only by the basket's creator. There is no admin path to
    ///      these funds.
    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert NotCreator(msg.sender);

        amount = accruedCreatorFees;
        if (amount == 0) revert NothingToClaim();

        // Effects before interaction.
        accruedCreatorFees = 0;
        IERC20(settlementToken).safeTransfer(creator, amount);

        emit CreatorFeesClaimed(creator, amount);
    }

    // ---------------------------------------------------------------------
    // Protocol administration
    // ---------------------------------------------------------------------

    /// @notice Withdraws accrued protocol fees to `to`.
    /// @dev Protocol admin only. Cannot touch holder assets or creator fees:
    ///      `accruedProtocolFees` is a separate liability.
    function withdrawProtocolFees(address to) external nonReentrant returns (uint256 amount) {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin(msg.sender);
        if (to == address(0)) revert ZeroAddress("to");

        amount = accruedProtocolFees;
        if (amount == 0) revert NothingToClaim();

        accruedProtocolFees = 0;
        IERC20(settlementToken).safeTransfer(to, amount);

        emit ProtocolFeesWithdrawn(to, amount);
    }

    /// @notice Halts deposits and redemptions.
    /// @dev Justified as an emergency lever: if a component, the price provider
    ///      or the DEX adapter is discovered to be compromised, the admin can
    ///      stop new value from entering or leaving through a broken path while
    ///      a replacement is deployed. It cannot move funds — holders keep
    ///      custody of their tokens and every balance stays on-chain.
    function pause() external {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin(msg.sender);
        _pause();
    }

    /// @notice Resumes deposits and redemptions.
    function unpause() external {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin(msg.sender);
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IThematicBasket
    function componentCount() external view returns (uint256) {
        return _components.length;
    }

    /// @inheritdoc IThematicBasket
    function componentAt(uint256 index) external view returns (address) {
        return _components[index];
    }

    /// @inheritdoc IThematicBasket
    function weightAt(uint256 index) external view returns (uint256) {
        return _weightsBps[index];
    }

    /// @inheritdoc IThematicBasket
    function decimalsAt(uint256 index) external view returns (uint8) {
        return _componentDecimals[index];
    }

    /// @inheritdoc IThematicBasket
    function getComposition()
        external
        view
        returns (address[] memory components, uint256[] memory weightsBps)
    {
        return (_components, _weightsBps);
    }

    /// @inheritdoc IThematicBasket
    /// @dev Sum of component value at the price provider's rate plus settlement
    ///      the basket holds that is not already owed as fees.
    function totalAssets() public view returns (uint256 assets) {
        assets = freeSettlementBalance();

        uint256 length = _components.length;
        for (uint256 i; i < length; ++i) {
            assets += BasketMath.valueOf(
                IERC20(_components[i]).balanceOf(address(this)),
                IPriceProvider(priceProvider).priceOf(_components[i]),
                _componentDecimals[i]
            );
        }
    }

    /// @inheritdoc IThematicBasket
    /// @dev Settlement the basket holds that is not owed to the creator or the
    ///      protocol. Accrued fees are excluded from NAV so that collected
    ///      revenue never shows up as holder value.
    function freeSettlementBalance() public view returns (uint256) {
        uint256 balance = IERC20(settlementToken).balanceOf(address(this));
        uint256 liabilities = accruedCreatorFees + accruedProtocolFees;
        return balance > liabilities ? balance - liabilities : 0;
    }

    /// @inheritdoc IThematicBasket
    /// @dev Settlement smallest units per one whole basket token. The priced
    ///      branch's `SHARE_SCALE` is not a display scale: it converts the
    ///      supply from basket smallest units to whole tokens, and the basket
    ///      token's 18 decimals cancel against it. The result is therefore
    ///      already in settlement smallest units, and the empty branch has to
    ///      return the same unit — one whole settlement token's worth — or NAV
    ///      would jump by a factor at the first deposit.
    function navPerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return settlementScale();
        return Math.mulDiv(totalAssets(), BasketMath.SHARE_SCALE, supply);
    }

    /// @inheritdoc IThematicBasket
    /// @dev Excludes swap slippage and the price impact of the deposit itself, so
    ///      it is an estimate: the authoritative figure is the `Deposit` event's
    ///      minted amount.
    function previewDeposit(
        uint256 amountIn
    ) external view returns (uint256 sharesOut, uint256 fee, uint256 netInvested) {
        fee = BasketMath.applyBps(amountIn, depositFeeBps);
        netInvested = amountIn - fee;
        sharesOut = BasketMath.sharesForDeposit(
            netInvested,
            totalAssets(),
            totalSupply(),
            settlementScale()
        );
    }

    /// @inheritdoc IThematicBasket
    /// @dev Estimates at NAV. The actual payout depends on realised swap output.
    function previewRedeem(
        uint256 shares
    ) external view returns (uint256 settlementOut, uint256 fee, uint256 gross) {
        gross = BasketMath.proRata(totalAssets(), shares, totalSupply());
        fee = BasketMath.applyBps(gross, redeemFeeBps);
        settlementOut = gross - fee;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev Pulls the settlement token and verifies the basket actually received
    ///      the full amount. A fee-on-transfer or rebasing settlement token would
    ///      otherwise be accounted at face value while delivering less, and the
    ///      shortfall would be paid by existing holders.
    function _pullSettlement(address from, uint256 amount) private returns (uint256 received) {
        IERC20 settlement = IERC20(settlementToken);
        uint256 balanceBefore = settlement.balanceOf(address(this));

        settlement.safeTransferFrom(from, address(this), amount);

        received = settlement.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnsupportedSettlementToken(amount, received);
    }

    /// @dev Splits a fee between creator and protocol and records both as
    ///      liabilities of the basket. Returns the amount the caller actually
    ///      keeps or receives.
    function _accrueFee(
        uint256 amount,
        uint16 feeBps
    ) private returns (uint256 creatorFee, uint256 protocolFee, uint256 net) {
        uint256 fee = BasketMath.applyBps(amount, feeBps);
        (creatorFee, protocolFee) = BasketMath.splitFee(fee, creatorShareBps);

        if (creatorFee != 0) accruedCreatorFees += creatorFee;
        if (protocolFee != 0) accruedProtocolFees += protocolFee;

        net = amount - fee;
    }

    /// @dev Spends the settlement balance across the basket's components at their
    ///      configured weights, and returns the value received.
    function _buyComponents(
        uint256 netAmount,
        uint256 deadline
    ) private returns (uint256 valueAdded) {
        uint256[] memory amounts = _allocate(netAmount);
        uint256 length = amounts.length;

        for (uint256 i; i < length; ++i) {
            if (amounts[i] == 0) continue;
            valueAdded += _buyComponent(i, amounts[i], deadline);
        }
    }

    /// @dev Buys one component and reports what the purchase is worth at the
    ///      price provider's rate. Split out of the loop above to keep the number
    ///      of live locals low enough for the non-IR code generator.
    function _buyComponent(
        uint256 index,
        uint256 amountIn,
        uint256 deadline
    ) private returns (uint256 valueAdded) {
        address component = _components[index];
        uint256 price = _priceOf(component);
        uint8 decimals = _componentDecimals[index];

        uint256 expectedOut = BasketMath.componentAmountFor(amountIn, price, decimals);
        if (expectedOut == 0) revert DepositTooSmall(component);

        IERC20(settlementToken).forceApprove(address(dexAdapter), amountIn);
        uint256 received = IDexAdapter(dexAdapter).swapExactTokensForTokens(
            amountIn,
            _floorAfterSlippage(expectedOut),
            settlementToken,
            component,
            address(this),
            deadline
        );
        IERC20(settlementToken).forceApprove(address(dexAdapter), 0);

        return BasketMath.valueOf(received, price, decimals);
    }

    /// @dev Sells a set of component amounts back into the settlement token.
    function _sellComponents(
        uint256[] memory amounts,
        uint256 deadline
    ) private returns (uint256 gross) {
        uint256 length = amounts.length;

        for (uint256 i; i < length; ++i) {
            if (amounts[i] == 0) continue;
            gross += _sellComponent(i, amounts[i], deadline);
        }
    }

    /// @dev Sells one component. Split out for the same reason as {_buyComponent}.
    function _sellComponent(
        uint256 index,
        uint256 amountIn,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        address component = _components[index];
        uint256 expectedOut = BasketMath.valueOf(
            amountIn,
            _priceOf(component),
            _componentDecimals[index]
        );
        if (expectedOut == 0) revert RedemptionTooSmall(component);

        IERC20(component).forceApprove(address(dexAdapter), amountIn);
        amountOut = IDexAdapter(dexAdapter).swapExactTokensForTokens(
            amountIn,
            _floorAfterSlippage(expectedOut),
            component,
            settlementToken,
            address(this),
            deadline
        );
        IERC20(component).forceApprove(address(dexAdapter), 0);
    }

    /// @dev Splits `amount` across the components at their configured weights.
    ///      Every component but the last is rounded down; the last takes the
    ///      remainder, so basis-point truncation cannot strand settlement in the
    ///      contract and the parts always sum to `amount`.
    function _allocate(uint256 amount) private view returns (uint256[] memory amounts) {
        uint256 length = _components.length;
        amounts = new uint256[](length);

        uint256 allocated;
        for (uint256 i; i < length; ++i) {
            if (i == length - 1) {
                amounts[i] = amount - allocated;
            } else {
                amounts[i] = BasketMath.applyBps(amount, _weightsBps[i]);
                allocated += amounts[i];
            }
        }
    }

    /// @dev Reads a component's price, refusing to act on an unpriceable asset.
    ///      Treating a missing price as zero would let a deposit mint nothing and
    ///      a redemption pay nothing, so it reverts instead.
    function _priceOf(address component) private view returns (uint256 price) {
        price = IPriceProvider(priceProvider).priceOf(component);
        if (price == 0) revert ComponentNotPriceable(component);
    }

    /// @dev Applies the basket's slippage tolerance to an expected output. The
    ///      protocol never passes an output floor of zero to a swap.
    function _floorAfterSlippage(uint256 expected) private view returns (uint256) {
        return
            Math.mulDiv(
                expected,
                BasketMath.BPS_DENOMINATOR - maxSlippageBps,
                BasketMath.BPS_DENOMINATOR
            );
    }

    /// @dev `10 ** settlementDecimals`, cached from the immutable decimals. Used
    ///      only to express share amounts in whole settlement units at launch.
    function settlementScale() private view returns (uint256) {
        return 10 ** uint256(settlementDecimals);
    }

    function _requireAccount(address account, string memory field) private pure {
        if (account == address(0)) revert ZeroAddress(field);
    }

    function _requireContract(address account, string memory field) private view {
        if (account == address(0)) revert ZeroAddress(field);
        if (account.code.length == 0) revert AddressHasNoCode(field, account);
    }
}
