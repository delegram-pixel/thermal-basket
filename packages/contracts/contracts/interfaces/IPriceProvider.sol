// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPriceProvider
/// @notice Valuation source a basket consults to convert component token
///         balances into settlement-token terms.
///
/// @dev Implementations are trusted infrastructure: they are configured on the
///      factory by the protocol admin and are the sole authority for NAV,
///      deposit minting and redemption slippage floors. A basket never prices
///      its own holdings from a DEX pool, because pool spot prices are
///      flash-loan manipulable within a single transaction.
///
/// Price convention
/// ----------------
/// A price is **the value of one whole component token, denominated in the
/// settlement token's smallest unit.** There is no separate scale factor.
///
/// For a component worth 175.42 units of an 18-decimal settlement token, the
/// price is `175.42e18`. The same component under a 6-decimal settlement token
/// would be priced `175_420_000`.
///
/// One convention, applied in exactly one place ({BasketMath-valueOf} and
/// {BasketMath-componentAmountFor}), because a second scale factor is how funds
/// get mispriced by orders of magnitude without anyone noticing.
interface IPriceProvider {
    /// @notice Value of one whole `asset` token, in the settlement token's
    ///         smallest unit.
    /// @param asset Component token address.
    /// @return price Price as described above. MUST return 0 for an asset it
    ///         cannot price; callers treat 0 as "unpriceable" and refuse to act
    ///         on it rather than valuing the holding at nothing.
    function priceOf(address asset) external view returns (uint256 price);
}
