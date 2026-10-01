// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockCallbackERC20
/// @notice An ERC-20 that calls out to an arbitrary address during a transfer,
///         used to prove the basket's reentrancy guard actually holds.
///
/// @dev A token with a transfer hook is the realistic reentrancy vector for this
///      protocol: the basket calls `transferFrom` in the middle of a deposit and
///      a redemption, so a hostile settlement token gets control while the
///      basket is mid-operation. Without a guard, a second `deposit` or `redeem`
///      entered at that point would act on state the outer call has already
///      computed against — the classic way to mint shares against assets that do
///      not exist yet.
///
///      The callback is one-shot: it disarms itself before calling, so a test
///      cannot accidentally build an infinite loop, and a reverted callback
///      surfaces the inner reason rather than an opaque failure.
///
///      Test networks only.
contract MockCallbackERC20 is ERC20 {
    uint8 private immutable _decimals;

    address public callbackTarget;
    bytes public callbackData;
    bool public callbackArmed;

    event CallbackArmed(address indexed target, bytes data);
    event CallbackFired(address indexed target, bool success);

    error ZeroAddress(string field);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mints `amount` to `to`.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arms a one-shot callback, fired on the next transfer between two
    ///         non-zero addresses.
    /// @param target Contract to call.
    /// @param data Calldata to send it.
    function armCallback(address target, bytes calldata data) external {
        if (target == address(0)) revert ZeroAddress("target");
        callbackTarget = target;
        callbackData = data;
        callbackArmed = true;
        emit CallbackArmed(target, data);
    }

    /// @notice Disarms the callback without firing it.
    function disarm() external {
        callbackArmed = false;
    }

    /// @dev Fires the callback after the balance change lands, and bubbles up the
    ///      inner revert so a test can assert on the guard's own error.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (!callbackArmed || from == address(0) || to == address(0)) return;

        address target = callbackTarget;
        bytes memory data = callbackData;
        callbackArmed = false;

        (bool ok, bytes memory result) = target.call(data);
        emit CallbackFired(target, ok);

        if (!ok) {
            // Re-raise the inner failure verbatim, so a caller sees why the
            // reentrant call was rejected rather than a generic wrapper.
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}
