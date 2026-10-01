// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IDexAdapter } from "../interfaces/IDexAdapter.sol";
import { IPancakeRouter02 } from "../interfaces/external/IPancakeRouter02.sol";

/// @title PancakeSwapAdapter
/// @notice Routes basket swaps through a PancakeSwap V2 style router.
///
/// @dev Why this exists at all
/// --------------------------
/// Baskets hold `IDexAdapter`, not a router address. Every router-specific
/// detail — the path array, the pull-then-forward token dance, approval
/// hygiene — is confined here. Swapping venues means deploying a new adapter
/// and pointing the factory at it for future baskets; no basket code changes.
///
/// Token flow
/// ----------
/// The router pulls its input from `msg.sender`, so the adapter cannot simply
/// pass the basket's approval through. It pulls `amountIn` from the caller,
/// approves the router, swaps with `recipient` as the output destination, then
/// clears the approval. The output never rests in the adapter: it goes straight
/// from the router to `recipient`, so a compromised or upgraded adapter cannot
/// accumulate funds by leaving a swap half-finished.
///
/// Path construction
/// -----------------
/// A direct pair is tried first. If the router reports no direct market the
/// adapter falls back to routing through the wrapped native token, which is how
/// the large majority of BSC liquidity is reachable. A missing route surfaces as
/// the router's own revert rather than a silent zero.
contract PancakeSwapAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    /// @notice Router every swap is sent to.
    IPancakeRouter02 public immutable router;

    /// @notice Wrapped native token used to bridge pairs with no direct market.
    address public immutable wrappedNative;

    error ZeroAddress(string field);
    error AddressHasNoCode(string field, address account);
    error DeadlineExpired(uint256 timestamp, uint256 deadline);
    error ZeroAmountIn();
    error IdenticalTokens(address token);
    error NoRoute(address tokenIn, address tokenOut);
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);

    /// @param router_ PancakeSwap V2 compatible router.
    constructor(address router_) {
        if (router_ == address(0)) revert ZeroAddress("router");
        if (router_.code.length == 0) revert AddressHasNoCode("router", router_);

        router = IPancakeRouter02(router_);
        wrappedNative = IPancakeRouter02(router_).WETH();
    }

    /// @inheritdoc IDexAdapter
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 minAmountOut,
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);
        if (amountIn == 0) revert ZeroAmountIn();
        if (tokenIn == tokenOut) revert IdenticalTokens(tokenIn);
        if (recipient == address(0)) revert ZeroAddress("recipient");

        address[] memory path = _buildPath(tokenIn, tokenOut);

        // Pull the input from the caller, who has approved this adapter.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve exactly what this swap needs, then clear it. A residual
        // allowance to a router is a standing claim on adapter-held tokens.
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            recipient,
            deadline
        );
        IERC20(tokenIn).forceApprove(address(router), 0);

        amountOut = amounts[amounts.length - 1];
        // The router is trusted to enforce its own floor, but the caller's
        // protection must not depend on that. Re-check here so a router that
        // silently under-delivers cannot slip past the basket's slippage bound.
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
    }

    /// @inheritdoc IDexAdapter
    function quoteExactTokensForTokens(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) return 0;

        address[] memory path = _tryBuildPath(tokenIn, tokenOut);
        if (path.length == 0) return 0;

        // Quoting is best-effort: a preview must not revert because a route is
        // momentarily missing, so a failed quote reads as zero output.
        try router.getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    /// @inheritdoc IDexAdapter
    function adapterName() external pure returns (string memory) {
        return "PancakeSwap V2";
    }

    /// @dev Direct pair if it exists, otherwise a hop through the wrapped native
    ///      token. Reverts when neither has liquidity.
    function _buildPath(
        address tokenIn,
        address tokenOut
    ) private view returns (address[] memory path) {
        path = _tryBuildPath(tokenIn, tokenOut);
        if (path.length == 0) revert NoRoute(tokenIn, tokenOut);
    }

    function _tryBuildPath(
        address tokenIn,
        address tokenOut
    ) private view returns (address[] memory path) {
        address[] memory direct = new address[](2);
        direct[0] = tokenIn;
        direct[1] = tokenOut;
        if (_hasRoute(direct)) return direct;

        address bridge = wrappedNative;
        if (bridge == address(0) || bridge == tokenIn || bridge == tokenOut) {
            return new address[](0);
        }

        address[] memory bridged = new address[](3);
        bridged[0] = tokenIn;
        bridged[1] = bridge;
        bridged[2] = tokenOut;
        if (_hasRoute(bridged)) return bridged;

        return new address[](0);
    }

    /// @dev Probes a route with one whole unit of the input token. Probing with a
    ///      single smallest unit would round to zero on a pair where the two
    ///      tokens have very different decimals, and a route that exists would
    ///      look like one that does not.
    function _hasRoute(address[] memory path) private view returns (bool) {
        try router.getAmountsOut(_probeAmount(path[0]), path) returns (uint256[] memory amounts) {
            return amounts.length == path.length && amounts[amounts.length - 1] > 0;
        } catch {
            return false;
        }
    }

    /// @dev One whole unit of `token`, falling back to 1e18 for a token that does
    ///      not report decimals. A probe is a liveness check, not a valuation, so
    ///      a fallback is acceptable here in a way it would not be for a price.
    function _probeAmount(address token) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length < 32) return 1e18;

        uint8 decimals = uint8(abi.decode(data, (uint256)));
        if (decimals > 36) return 1e18;
        return 10 ** uint256(decimals);
    }
}
