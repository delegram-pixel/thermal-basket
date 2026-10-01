// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IDexAdapter
/// @notice Abstraction over a decentralised exchange so that baskets never talk
///         to a router directly.
/// @dev The basket approves the adapter and the adapter pulls `amountIn` from
///      the caller. Router-specific concerns (path construction, router
///      approvals, WETH-style wrapping, per-DEX quirks) stay inside the
///      implementation, which keeps the DEX replaceable without redeploying a
///      single basket.
interface IDexAdapter {
    /// @notice Swaps an exact input amount of `tokenIn` for `tokenOut`.
    /// @dev Implementations MUST revert when the realised output is below
    ///      `minAmountOut`; returning a smaller amount silently is not
    ///      acceptable. `amountOutMin = 0` is never passed by this protocol.
    /// @param amountIn Exact amount of `tokenIn` to sell. Pulled from `msg.sender`.
    /// @param minAmountOut Minimum acceptable `tokenOut`; reverts below this.
    /// @param tokenIn Token sold.
    /// @param tokenOut Token bought.
    /// @param recipient Address receiving `tokenOut`.
    /// @param deadline Unix timestamp after which the swap is invalid.
    /// @return amountOut Actual amount of `tokenOut` delivered to `recipient`.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 minAmountOut,
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut);

    /// @notice Quotes a swap without executing it.
    /// @dev Best-effort read used for previews and for computing slippage
    ///      floors. Never used as the settlement price of a completed swap —
    ///      the realised balance delta is.
    function quoteExactTokensForTokens(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 amountOut);

    /// @notice Human-readable adapter identifier, surfaced in the UI so a user
    ///         can see which venue a basket routes through.
    function adapterName() external view returns (string memory name);
}
