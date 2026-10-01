// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Test and testnet token with configurable decimals and an open mint.
///
/// @dev This contract is for local chains and BSC testnet only. It has no supply
///      cap and no access control on `mint`, so anyone can issue themselves any
///      amount. It must never be deployed to a network where it would be treated
///      as carrying value — the frontend labels every asset backed by it as mock
///      data, and the deploy scripts refuse to run it outside a test network.
///
///      It stands in for two different things during development: the settlement
///      asset, and the tokenized equities a basket holds. Decimals are a
///      constructor argument specifically so tests can cover baskets mixing
///      6-, 8- and 18-decimal components, which is where valuation bugs live.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    /// @param name_ Token name, e.g. "Mock NVIDIA".
    /// @param symbol_ Token symbol, e.g. "mNVDA".
    /// @param decimals_ Token decimals. Not restricted: testing mixed-decimal
    ///        baskets is the point.
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mints `amount` to `to`. Unrestricted by design.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Burns `amount` from the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
