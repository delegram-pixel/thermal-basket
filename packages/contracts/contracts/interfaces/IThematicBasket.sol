// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IThematicBasket
/// @notice External surface of a single thematic basket.
/// @dev Deliberately separate from the implementation so the frontend, the
///      factory and any future integration can bind to a stable ABI. All
///      monetary values are integers in settlement-token smallest units or in
///      basis points; nothing here is a float and nothing is a percentage.
interface IThematicBasket is IERC20 {
    /// @notice Emitted when a holder invests settlement tokens.
    /// @param account Investor.
    /// @param amountIn Settlement tokens pulled from the investor, before fees.
    /// @param netInvested Settlement tokens actually spent buying components.
    /// @param sharesOut Basket tokens minted to the investor.
    event Deposit(
        address indexed account,
        uint256 amountIn,
        uint256 netInvested,
        uint256 sharesOut
    );

    /// @notice Emitted when a holder redeems basket tokens.
    /// @param account Redeemer.
    /// @param shares Basket tokens burned.
    /// @param grossSettlement Settlement raised by selling the pro-rata slice,
    ///        before the redemption fee.
    /// @param netSettlement Settlement paid to the redeemer, after the fee.
    event Redeem(
        address indexed account,
        uint256 shares,
        uint256 grossSettlement,
        uint256 netSettlement
    );

    /// @notice Emitted whenever a fee is taken, on deposits and redemptions
    ///         alike. Both parts are recorded as liabilities of the basket and
    ///         excluded from net asset value.
    /// @param account The holder whose action generated the fee.
    /// @param creatorFee Accrued to the basket creator.
    /// @param protocolFee Accrued to the protocol treasury.
    event FeesAccrued(address indexed account, uint256 creatorFee, uint256 protocolFee);

    /// @notice Emitted when the creator withdraws accrued fees.
    event CreatorFeesClaimed(address indexed creator, uint256 amount);

    /// @notice Emitted when the protocol admin withdraws accrued fees.
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    /// @notice Settlement asset investors deposit and redeem into.
    function settlementToken() external view returns (address);

    /// @notice Valuation source for every component.
    function priceProvider() external view returns (address);

    /// @notice Venue every swap routes through.
    function dexAdapter() external view returns (address);

    /// @notice Recipient of the creator's share of fees.
    function creator() external view returns (address);

    /// @notice Address permitted to pause the basket and withdraw protocol fees.
    function protocolAdmin() external view returns (address);

    /// @notice Recipient of the protocol's share of fees.
    function protocolTreasury() external view returns (address);

    /// @notice Deposit fee in basis points.
    function depositFeeBps() external view returns (uint16);

    /// @notice Redemption fee in basis points.
    function redeemFeeBps() external view returns (uint16);

    /// @notice Creator's share of collected fees, in basis points.
    function creatorShareBps() external view returns (uint16);

    /// @notice Per-swap slippage tolerance in basis points.
    function maxSlippageBps() external view returns (uint16);

    /// @notice Decimals of the settlement token, cached at creation.
    function settlementDecimals() external view returns (uint8);

    /// @notice Short theme label.
    function theme() external view returns (string memory);

    /// @notice Free-form investment thesis for the theme.
    function description() external view returns (string memory);

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    /// @notice Creator fees accrued and not yet claimed.
    function accruedCreatorFees() external view returns (uint256);

    /// @notice Protocol fees accrued and not yet withdrawn.
    function accruedProtocolFees() external view returns (uint256);

    // ---------------------------------------------------------------------
    // Composition
    // ---------------------------------------------------------------------

    /// @notice Number of components in the basket.
    function componentCount() external view returns (uint256);

    /// @notice Component token at `index`.
    function componentAt(uint256 index) external view returns (address);

    /// @notice Weight of the component at `index`, in basis points.
    function weightAt(uint256 index) external view returns (uint256);

    /// @notice Cached decimals of the component at `index`.
    function decimalsAt(uint256 index) external view returns (uint8);

    /// @notice The full composition as parallel arrays. Weights sum to 10 000.
    function getComposition()
        external
        view
        returns (address[] memory components, uint256[] memory weightsBps);

    // ---------------------------------------------------------------------
    // Valuation
    // ---------------------------------------------------------------------

    /// @notice Value of everything the basket holds, in settlement smallest
    ///         units, at the price provider's current rates. Excludes settlement
    ///         already owed to the creator or the protocol as fees.
    function totalAssets() external view returns (uint256);

    /// @notice Settlement held by the basket that is not owed as fees.
    function freeSettlementBalance() external view returns (uint256);

    /// @notice Value of one whole basket token, in settlement smallest units.
    ///         Divide by the settlement token's own scale to display.
    /// @dev A basket launches at exactly one whole settlement unit per basket
    ///      token, so an empty basket reports `10 ** settlementDecimals` and a
    ///      funded one reports the same figure until prices move. There is no
    ///      additional scale factor to undo.
    function navPerShare() external view returns (uint256);

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    /// @notice Invests settlement tokens and mints basket tokens.
    /// @param amountIn Settlement tokens to invest; approve this contract first.
    /// @param minSharesOut Minimum acceptable mint, for slippage protection.
    /// @param deadline Unix timestamp after which the call reverts.
    function deposit(
        uint256 amountIn,
        uint256 minSharesOut,
        uint256 deadline
    ) external returns (uint256 sharesOut);

    /// @notice Burns basket tokens and pays out settlement tokens.
    /// @param shares Basket tokens to burn.
    /// @param minSettlementOut Minimum acceptable payout, for slippage protection.
    /// @param deadline Unix timestamp after which the call reverts.
    function redeem(
        uint256 shares,
        uint256 minSettlementOut,
        uint256 deadline
    ) external returns (uint256 settlementOut);

    /// @notice Withdraws the creator's accrued fees. Creator only.
    function claimCreatorFees() external returns (uint256 amount);

    /// @notice Withdraws accrued protocol fees. Protocol admin only.
    function withdrawProtocolFees(address to) external returns (uint256 amount);

    // ---------------------------------------------------------------------
    // Previews
    // ---------------------------------------------------------------------

    /// @notice Estimates a deposit at current prices and NAV.
    /// @dev Excludes swap slippage and the deposit's own price impact, so it is
    ///      an estimate. The `Deposit` event carries the authoritative figure.
    /// @return sharesOut Basket tokens that would be minted.
    /// @return fee Deposit fee in settlement smallest units.
    /// @return netInvested Settlement spent buying components.
    function previewDeposit(
        uint256 amountIn
    ) external view returns (uint256 sharesOut, uint256 fee, uint256 netInvested);

    /// @notice Estimates a redemption at current prices and NAV.
    /// @dev Excludes realised swap output, so it is an estimate. The `Redeem`
    ///      event carries the authoritative figure.
    /// @return settlementOut Settlement that would be paid, after fees.
    /// @return fee Redemption fee in settlement smallest units.
    /// @return gross Settlement raised before the fee.
    function previewRedeem(
        uint256 shares
    ) external view returns (uint256 settlementOut, uint256 fee, uint256 gross);
}
