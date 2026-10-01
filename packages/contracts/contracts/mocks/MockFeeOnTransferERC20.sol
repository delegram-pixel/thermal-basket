// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeOnTransferERC20
/// @notice A token that burns a cut of every transfer, used to prove the basket
///         rejects it as a settlement asset.
///
/// @dev This exists for one negative test and nothing else. A basket measures the
///      settlement it receives by balance delta and reverts when that is short of
///      what was asked for; without this token that guard would be untested code
///      guarding a real loss. If a fee-on-transfer token were ever accepted, every
///      depositor would be silently short-changed by the transfer fee and the
///      shortfall would be socialised across existing holders.
///
///      Test networks only.
contract MockFeeOnTransferERC20 is ERC20 {
    /// @notice Fee taken on every transfer, in basis points.
    uint256 public immutable feeBps;
    uint8 private immutable _decimals;

    event FeeBurned(address indexed from, uint256 amount);

    error FeeTooHigh(uint256 feeBps, uint256 maximum);

    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param decimals_ Token decimals.
    /// @param feeBps_ Transfer fee in basis points. Capped at 10% so a test cannot
    ///        configure something the protocol would never have to face.
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 feeBps_
    ) ERC20(name_, symbol_) {
        if (feeBps_ > 1_000) revert FeeTooHigh(feeBps_, 1_000);
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mints `amount` to `to`.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Burns `feeBps` of the transferred amount from the sender on top of
    ///      moving the remainder, so the recipient receives less than was sent.
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / 10_000;
        if (fee != 0) {
            super._update(from, address(0), fee);
            emit FeeBurned(from, fee);
        }
        super._update(from, to, value - fee);
    }
}
