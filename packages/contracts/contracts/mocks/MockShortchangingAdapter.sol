// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IDexAdapter } from "../interfaces/IDexAdapter.sol";

/// @title MockShortchangingAdapter
/// @notice A deliberately faulty DEX adapter: it honours the swap request but
///         pays out less than the floor it was given, and returns normally
///         instead of reverting.
///
/// @dev Why this exists
/// -------------------
/// {IDexAdapter} requires implementations to revert when the realised output is
/// below `minAmountOut`. A correct router enforces that floor itself, so the
/// basket's own post-swap checks never fire in practice — which means they would
/// otherwise be untested code guarding real money.
///
/// This adapter is the adversary that makes them reachable: it is a venue that
/// lies. It pulls the input, pays out `minAmountOut * fillBps / 10_000` of its
/// own inventory, and reports success. A basket pointed at it must still refuse
/// to mint shares against value it did not receive, and must still refuse to pay
/// out a redemption below the holder's minimum.
///
/// It never touches the real `MockDexRouter`, so a test using it is asserting on
/// the basket's guards and nothing else.
///
///      Test networks only.
contract MockShortchangingAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    /// @notice Denominator for `fillBps`.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Address allowed to configure the shortfall.
    address public immutable owner;

    /// @notice Share of the caller's floor actually delivered, in basis points.
    ///         Set below 10 000 to under-deliver; 10 000 means honest.
    uint256 public fillBps;

    event FillBpsUpdated(uint256 previous, uint256 current);
    event UnderDelivered(address indexed tokenOut, uint256 requestedFloor, uint256 delivered);

    error NotOwner(address caller);
    error FillTooHigh(uint256 provided, uint256 maximum);
    error InsufficientInventory(address token, uint256 requested, uint256 available);
    error DeadlineExpired(uint256 timestamp, uint256 deadline);

    /// @param owner_ Address allowed to call {setFillBps}.
    /// @param fillBps_ Initial shortfall, below 10 000.
    constructor(address owner_, uint256 fillBps_) {
        owner = owner_;
        _setFillBps(fillBps_);
    }

    /// @notice Sets how much of the caller's floor is actually delivered.
    /// @param fillBps_ Basis points of `minAmountOut` to pay out. Must be at most
    ///        10 000 — the point is to under-deliver, not to over-deliver.
    function setFillBps(uint256 fillBps_) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _setFillBps(fillBps_);
    }

    /// @notice Funds this adapter's inventory so it can pay out.
    /// @dev The test seeds this; a real adapter holds nothing between calls.
    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @inheritdoc IDexAdapter
    /// @dev Pulls `amountIn`, ignores `minAmountOut`, and pays out a shortfall
    ///      fraction of it. Returns success either way.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 minAmountOut,
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = (minAmountOut * fillBps) / BPS_DENOMINATOR;

        uint256 available = IERC20(tokenOut).balanceOf(address(this));
        if (available < amountOut) {
            revert InsufficientInventory(tokenOut, amountOut, available);
        }

        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        emit UnderDelivered(tokenOut, minAmountOut, amountOut);
    }

    /// @inheritdoc IDexAdapter
    /// @dev Reports the shortfall up front, so a preview is as wrong as the
    ///      execution it is previewing.
    function quoteExactTokensForTokens(
        uint256 amountIn,
        address,
        address
    ) external view returns (uint256 amountOut) {
        return (amountIn * fillBps) / BPS_DENOMINATOR;
    }

    /// @inheritdoc IDexAdapter
    function adapterName() external pure returns (string memory) {
        return "Shortchanging (test only)";
    }

    /// @dev Applies and records a new shortfall, rejecting anything above par.
    function _setFillBps(uint256 fillBps_) private {
        if (fillBps_ > BPS_DENOMINATOR) revert FillTooHigh(fillBps_, BPS_DENOMINATOR);
        uint256 previous = fillBps;
        fillBps = fillBps_;
        emit FillBpsUpdated(previous, fillBps_);
    }
}
