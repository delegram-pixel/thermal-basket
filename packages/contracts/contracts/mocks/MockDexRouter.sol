// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPancakeRouter02 } from "../interfaces/external/IPancakeRouter02.sol";

/// @title MockDexRouter
/// @notice A constant-product AMM implementing the PancakeSwap V2 router
///         interface, for local chains and BSC testnet.
///
/// @dev Why not a 1:1 stub
/// ----------------------
/// A router that always returns exactly what was asked for would make every test
/// pass and prove nothing: the deposit slippage floor, the redemption minimum,
/// the price-impact path and the "swap delivered less than the oracle said"
/// branch would all be dead code. This router prices swaps with the real
/// `x * y = k` formula and a 0.3% fee, so a large deposit genuinely moves the
/// price and genuinely trips the basket's slippage checks. The adapter, the
/// basket and the tests are therefore exercised against the behaviour they will
/// meet on mainnet.
///
/// Liquidity is seeded through {seed}, which pulls real tokens from the caller
/// and records matching reserves, so the router's balances always back the
/// reserves it quotes against. It cannot promise output it cannot pay.
///
/// This contract is for test networks only. It has no access control on {seed}
/// and no governance: anyone may add liquidity, which is exactly what a test
/// venue should allow.
contract MockDexRouter is IPancakeRouter02 {
    using SafeERC20 for IERC20;

    /// @notice Swap fee in the same form PancakeSwap uses: 0.3%, applied as
    ///         `amountInWithFee = amountIn * 997 / 1000`.
    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;

    /// @notice Wrapped native token. Set at construction so the adapter's
    ///         bridged-route probing behaves as it does against a real router.
    address public immutable override WETH;

    /// @notice Reserves per ordered pair, kept symmetric on write.
    mapping(address => mapping(address => uint256)) public reserves;

    /// @notice Whether a pair has ever been seeded.
    mapping(address => mapping(address => bool)) public pairExists;

    event Seeded(
        address indexed tokenA,
        address indexed tokenB,
        uint256 reserveA,
        uint256 reserveB
    );
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    error ZeroAddress(string field);
    error IdenticalTokens(address token);
    error PairNotFound(address tokenIn, address tokenOut);
    error InsufficientLiquidity(address tokenIn, address tokenOut);
    error InsufficientOutput(uint256 amountOut, uint256 amountOutMin);
    error InsufficientInput(uint256 amountIn, uint256 amountInRequired);
    error DeadlineExpired(uint256 timestamp, uint256 deadline);
    error InvalidPath();

    /// @param wrappedNative Wrapped native token address. Any address will do on
    ///        a test chain; the adapter only uses it as a bridge hop.
    constructor(address wrappedNative) {
        if (wrappedNative == address(0)) revert ZeroAddress("wrappedNative");
        WETH = wrappedNative;
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /// @notice Seeds a pair, pulling both tokens from the caller.
    /// @dev Reserves are added to whatever is already there, so a pair can be
    ///      topped up to demonstrate deeper or thinner liquidity.
    /// @param tokenA First token.
    /// @param tokenB Second token.
    /// @param amountA Amount of `tokenA` to add.
    /// @param amountB Amount of `tokenB` to add.
    function seed(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress("token");
        if (tokenA == tokenB) revert IdenticalTokens(tokenA);

        if (amountA != 0) IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        if (amountB != 0) IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        reserves[tokenA][tokenB] += amountA;
        reserves[tokenB][tokenA] += amountB;
        pairExists[tokenA][tokenB] = true;
        pairExists[tokenB][tokenA] = true;

        emit Seeded(tokenA, tokenB, reserves[tokenA][tokenB], reserves[tokenB][tokenA]);
    }

    // ---------------------------------------------------------------------
    // Router interface
    // ---------------------------------------------------------------------

    /// @inheritdoc IPancakeRouter02
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        return _getAmountsOut(amountIn, path);
    }

    /// @inheritdoc IPancakeRouter02
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);
        if (to == address(0)) revert ZeroAddress("to");

        amounts = _getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        if (amountOut < amountOutMin) revert InsufficientOutput(amountOut, amountOutMin);

        // Pull the input before paying anything out. The caller has approved
        // this router, which is the standard V2 flow.
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);

        // Walk the path, moving reserves and balances hop by hop.
        for (uint256 i; i < path.length - 1; ++i) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];

            reserves[tokenIn][tokenOut] += amounts[i];
            reserves[tokenOut][tokenIn] -= amounts[i + 1];
        }

        IERC20(path[path.length - 1]).safeTransfer(to, amountOut);

        emit Swap(msg.sender, path[0], path[path.length - 1], amountIn, amountOut);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _getAmountsOut(
        uint256 amountIn,
        address[] memory path
    ) private view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i; i < path.length - 1; ++i) {
            amounts[i + 1] = _getAmountOut(amounts[i], path[i], path[i + 1]);
        }
    }

    /// @dev Constant product with the 0.3% fee taken on the input, exactly as
    ///      PancakeSwap V2 computes it.
    function _getAmountOut(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) private view returns (uint256 amountOut) {
        if (tokenIn == tokenOut) revert IdenticalTokens(tokenIn);
        if (!pairExists[tokenIn][tokenOut]) revert PairNotFound(tokenIn, tokenOut);

        uint256 reserveIn = reserves[tokenIn][tokenOut];
        uint256 reserveOut = reserves[tokenOut][tokenIn];
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity(tokenIn, tokenOut);

        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        amountOut =
            (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
        if (amountOut == 0) revert InsufficientInput(amountIn, 1);
        if (amountOut >= reserveOut) revert InsufficientLiquidity(tokenIn, tokenOut);
    }
}
