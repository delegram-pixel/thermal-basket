// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IBasketFactory
/// @notice Creation and registry surface for thematic baskets.
/// @dev The factory validates a composition, deploys the basket and keeps an
///      enumerable registry so the frontend can discover baskets without an
///      indexer. It holds no user funds and has no power over a basket once
///      deployed: every economic parameter a basket uses is copied into the
///      basket at construction and immutable thereafter.
interface IBasketFactory {
    /// @notice Parameters for a new basket.
    /// @param name Basket token name, e.g. "AI Winners".
    /// @param symbol Basket token symbol, e.g. "AIW".
    /// @param description Investment thesis shown on the basket page.
    /// @param theme Short theme label used for browsing.
    /// @param components Component token addresses.
    /// @param weightsBps Component weights in basis points; MUST sum to 10 000.
    /// @param creator Address entitled to the creator share of fees.
    /// @param depositFeeBps Deposit fee, capped by the factory's ceiling.
    /// @param redeemFeeBps Redemption fee, capped by the factory's ceiling.
    /// @param creatorShareBps Creator's share of fees, capped by the ceiling.
    /// @param maxSlippageBps Per-swap slippage tolerance, capped by the ceiling.
    struct CreateBasketParams {
        string name;
        string symbol;
        string description;
        string theme;
        address[] components;
        uint256[] weightsBps;
        address creator;
        uint16 depositFeeBps;
        uint16 redeemFeeBps;
        uint16 creatorShareBps;
        uint16 maxSlippageBps;
    }

    /// @notice Emitted when a basket is created.
    /// @param basket The deployed basket.
    /// @param creator The address entitled to the creator share of fees.
    /// @param name Basket token name.
    /// @param symbol Basket token symbol.
    /// @param theme Short theme label.
    /// @param components Component token addresses.
    /// @param weightsBps Component weights in basis points.
    event BasketCreated(
        address indexed basket,
        address indexed creator,
        string name,
        string symbol,
        string theme,
        address[] components,
        uint256[] weightsBps
    );

    /// @notice Emitted when the protocol admin changes a ceiling that applies to
    ///         baskets created from then on.
    /// @dev Never emitted for an existing basket's parameters — those are
    ///      immutable, and this event is the audit trail proving it.
    event CreationLimitsUpdated(
        uint16 maxDepositFeeBps,
        uint16 maxRedeemFeeBps,
        uint16 maxCreatorShareBps,
        uint16 maxSlippageBps
    );

    /// @notice Emitted when the protocol admin changes infrastructure used by
    ///         baskets created from then on.
    event InfrastructureUpdated(address priceProvider, address dexAdapter);

    /// @notice Emitted when the protocol admin changes the protocol treasury
    ///         used by baskets created from then on.
    event ProtocolTreasuryUpdated(address protocolTreasury);

    /// @notice Emitted when the protocol admin changes the component allowlist.
    event ComponentAllowlistUpdated(address indexed component, bool allowed);

    /// @notice Emitted when the protocol admin enables or disables the allowlist.
    event AllowlistEnforcementUpdated(bool enabled);

    /// @notice Emitted when the protocol admin changes default fee parameters
    ///         suggested to creators.
    event DefaultFeesUpdated(
        uint16 depositFeeBps,
        uint16 redeemFeeBps,
        uint16 creatorShareBps,
        uint16 maxSlippageBps
    );

    /// @notice Creates a basket.
    /// @dev Reverts if the composition is malformed, if the settlement token
    ///      appears as a component, if a component is not allowlisted while the
    ///      allowlist is enforced, or if a requested fee exceeds its ceiling.
    /// @return basket Address of the deployed basket.
    function createBasket(CreateBasketParams calldata params) external returns (address basket);

    /// @notice Address of the protocol administrator.
    function protocolAdmin() external view returns (address);

    /// @notice Settlement asset every basket created here uses.
    function settlementToken() external view returns (address);

    /// @notice Number of baskets created.
    function basketCount() external view returns (uint256);

    /// @notice Basket at `index` in creation order.
    function basketAt(uint256 index) external view returns (address);

    /// @notice Every basket in creation order.
    function allBaskets() external view returns (address[] memory);

    /// @notice Whether `account` created a basket through this factory.
    function isBasket(address account) external view returns (bool);

    /// @notice Baskets created by `creator`, in creation order.
    function basketsByCreator(address creator) external view returns (address[] memory);
}
