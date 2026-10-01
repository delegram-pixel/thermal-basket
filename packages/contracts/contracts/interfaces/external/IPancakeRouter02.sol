// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPancakeRouter02
/// @notice The subset of the PancakeSwap V2 router this protocol uses.
/// @dev Declared locally rather than imported from a package so the adapter
///      compiles against exactly the surface it calls, and so the mock router in
///      the test suite is provably signature-compatible with the real venue.
interface IPancakeRouter02 {
    /// @notice Swaps an exact input for as much output as possible along `path`.
    /// @param amountIn Exact input amount.
    /// @param amountOutMin Reverts if the output is below this.
    /// @param path Token route; `path[0]` is sold and the last element is bought.
    /// @param to Recipient of the output.
    /// @param deadline Unix timestamp after which the swap reverts.
    /// @return amounts Amount at each hop, starting with `amountIn`.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Output for a given exact input, without executing.
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);

    /// @notice Address of the wrapped native token, needed to route through it.
    function WETH() external view returns (address);
}
