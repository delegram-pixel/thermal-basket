// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title BasketMath
/// @notice Pure valuation, weight and fee arithmetic for thematic baskets.
/// @dev Every function here is exact-integer. There is no floating point and no
///      percentage convention anywhere in this codebase: weights, fees and
///      shares all use a 10 000 basis-point denominator.
///
///      Prices are the one place a scale could be introduced twice, so they have
///      exactly one definition, restated here and in {IPriceProvider}: a price is
///      the value of one whole component token in the settlement token's
///      smallest unit, with no additional multiplier.
library BasketMath {
    /// @notice Denominator for every basis-point value in the protocol.
    ///         10 000 bps = 100%. 50 bps = 0.5%.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Scale used when reporting the value of one whole basket token.
    ///         Applies to share prices only — component prices carry no scale.
    uint256 internal constant SHARE_SCALE = 1e18;

    /// @notice Largest component token decimals this contract will value. A
    ///         token claiming more is rejected at basket creation so the
    ///         10**decimals scaling below can never overflow.
    uint8 internal constant MAX_TOKEN_DECIMALS = 36;

    /// @notice Hard cap on components per basket. Every deposit and redemption
    ///         loops over the component list, so this bound is what keeps the
    ///         cost of a user action predictable and stops a basket from being
    ///         created that no one can afford to exit. Shared by the basket and
    ///         the factory so both enforce the same number.
    uint256 internal constant MAX_COMPONENTS = 10;

    error WeightLengthMismatch(uint256 components, uint256 weights);
    error NoComponents();
    error TooManyComponents(uint256 provided, uint256 maximum);
    error ZeroComponentAddress(uint256 index);
    error DuplicateComponent(address component);
    error ZeroWeight(uint256 index);
    error InvalidWeightTotal(uint256 total, uint256 expected);
    error ComponentDecimalsTooHigh(address component, uint8 decimals);
    error ComponentNotERC20Metadata(address component);

    /// @notice Validates a basket composition against every invariant the
    ///         protocol relies on. Called at basket creation; the factory calls
    ///         the same code before deploying, so a malformed basket cannot be
    ///         created even if a caller bypasses the factory.
    /// @param components Component token addresses.
    /// @param weightsBps Component weights in basis points; MUST sum to
    ///        {BPS_DENOMINATOR}.
    /// @param maximumComponents Upper bound on component count, enforced so a
    ///        deposit or redemption can never run an unbounded loop.
    function validateComposition(
        address[] memory components,
        uint256[] memory weightsBps,
        uint256 maximumComponents
    ) internal pure {
        uint256 length = components.length;

        if (length != weightsBps.length) revert WeightLengthMismatch(length, weightsBps.length);
        if (length == 0) revert NoComponents();
        if (length > maximumComponents) revert TooManyComponents(length, maximumComponents);

        uint256 totalWeight;
        for (uint256 i; i < length; ++i) {
            address component = components[i];
            if (component == address(0)) revert ZeroComponentAddress(i);

            uint256 weight = weightsBps[i];
            if (weight == 0) revert ZeroWeight(i);
            totalWeight += weight;

            // O(n^2) over at most `maximumComponents` entries. At the enforced
            // cap this is cheaper than the storage a set would cost, and it is
            // pure, so it runs at creation only.
            for (uint256 j = i + 1; j < length; ++j) {
                if (component == components[j]) revert DuplicateComponent(component);
            }
        }

        if (totalWeight != BPS_DENOMINATOR) {
            revert InvalidWeightTotal(totalWeight, BPS_DENOMINATOR);
        }
    }

    /// @notice Reads and range-checks a component's ERC-20 decimals.
    /// @dev Reverts on a token that does not expose `decimals()` — including an
    ///      address with no code at all. A basket built on such a token could
    ///      never be valued, so it is rejected at creation instead of failing
    ///      later inside a user's deposit.
    function readDecimals(address component) internal view returns (uint8 decimals) {
        if (component.code.length == 0) revert ComponentNotERC20Metadata(component);

        (bool ok, bytes memory data) = component.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length < 32) revert ComponentNotERC20Metadata(component);

        decimals = uint8(abi.decode(data, (uint256)));
        if (decimals > MAX_TOKEN_DECIMALS) {
            revert ComponentDecimalsTooHigh(component, decimals);
        }
    }

    /// @notice Values a component balance in settlement-token smallest units.
    /// @param balance Component balance in the component's own smallest unit.
    /// @param price Value of one whole component token in settlement smallest
    ///        units. See the note at the top of this library.
    /// @param decimals The component's ERC-20 decimals.
    function valueOf(
        uint256 balance,
        uint256 price,
        uint8 decimals
    ) internal pure returns (uint256) {
        if (balance == 0 || price == 0) return 0;
        return Math.mulDiv(balance, price, 10 ** uint256(decimals));
    }

    /// @notice Converts a settlement amount into the component amount it should
    ///         buy at the given price. Used to derive per-swap slippage floors.
    /// @dev The exact inverse of {valueOf}: a swap that fills at the oracle price
    ///      returns precisely this amount, so the floor derived from it is the
    ///      price the depositor was quoted.
    /// @param settlementAmount Settlement smallest units to spend.
    /// @param price Value of one whole component token in settlement smallest
    ///        units.
    /// @param decimals The component's ERC-20 decimals.
    function componentAmountFor(
        uint256 settlementAmount,
        uint256 price,
        uint8 decimals
    ) internal pure returns (uint256) {
        if (price == 0) return 0;
        return Math.mulDiv(settlementAmount, 10 ** uint256(decimals), price);
    }

    /// @notice Splits a settlement amount by basis points.
    /// @dev Truncates toward zero, so the protocol can never pay out more than
    ///      it took in. The remainder always lands on the second output.
    function applyBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, BPS_DENOMINATOR);
    }

    /// @notice Divides a fee between the basket creator and the protocol.
    /// @param feeAmount Total fee taken, in settlement smallest units.
    /// @param creatorShareBps Creator's share of the fee in basis points.
    /// @return creatorFee Amount accrued to the creator.
    /// @return protocolFee Amount accrued to the protocol. Computed as the
    ///         remainder rather than a second multiplication so the two parts
    ///         always sum to `feeAmount` exactly, with no rounding dust stranded
    ///         in the contract.
    function splitFee(
        uint256 feeAmount,
        uint256 creatorShareBps
    ) internal pure returns (uint256 creatorFee, uint256 protocolFee) {
        creatorFee = applyBps(feeAmount, creatorShareBps);
        protocolFee = feeAmount - creatorFee;
    }

    /// @notice Shares to mint for a deposit of `valueAdded`.
    /// @dev
    /// - First deposit (supply == 0): one whole basket token is minted per whole
    ///   settlement unit of value added, so a basket launches at exactly one
    ///   settlement unit per basket token whatever the settlement token's
    ///   decimals. `settlementScale` is `10 ** settlementDecimals`.
    /// - Later deposits: pro-rata against existing assets. If existing assets
    ///   are zero while supply is non-zero (a total loss), the deposit is
    ///   treated as a fresh start rather than reverting — existing shares are
    ///   already worth nothing, so no holder is diluted by it.
    /// @param valueAdded Settlement value actually received and held.
    /// @param totalAssetsBefore Basket assets measured before this deposit landed.
    /// @param supply Basket token supply before this deposit.
    /// @param settlementScale `10 ** settlementDecimals`.
    function sharesForDeposit(
        uint256 valueAdded,
        uint256 totalAssetsBefore,
        uint256 supply,
        uint256 settlementScale
    ) internal pure returns (uint256) {
        if (supply == 0 || totalAssetsBefore == 0) {
            return Math.mulDiv(valueAdded, SHARE_SCALE, settlementScale);
        }
        return Math.mulDiv(valueAdded, supply, totalAssetsBefore);
    }

    /// @notice A holder's pro-rata slice of a pooled amount.
    function proRata(
        uint256 pooledAmount,
        uint256 shares,
        uint256 supply
    ) internal pure returns (uint256) {
        if (supply == 0 || shares == 0) return 0;
        return Math.mulDiv(pooledAmount, shares, supply);
    }
}
