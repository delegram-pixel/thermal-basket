// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IPriceProvider } from "../interfaces/IPriceProvider.sol";

/// @title MockPriceProvider
/// @notice Administrative price feed for local chains and BSC testnet.
///
/// @dev Why a mock feed is the honest choice for the MVP
/// ---------------------------------------------------
/// There are no tokenized equities on BSC testnet with a real market, so any
/// "price" there is invented. Rather than dress a constant up as an oracle, this
/// contract makes the invented part explicit and operator-controlled: prices are
/// set by an administrator and can be moved during a demo so that NAV changes
/// are visible. The frontend labels every value derived from it as mock data.
///
/// It is replaceable by design. A production deployment points the factory at a
/// real feed implementing the same {IPriceProvider} interface — the baskets do
/// not change.
///
/// Safety properties
/// -----------------
/// - An unset asset returns 0, which every caller in this protocol treats as
///   "unpriceable" and refuses to act on. There is no default price, because a
///   default price is a wrong price.
/// - A price can be withdrawn with {clearPrice} so a demo can show what a halted
///   or unpriceable asset looks like in the UI.
contract MockPriceProvider is IPriceProvider {
    /// @notice Administrator permitted to set prices.
    address public immutable admin;

    /// @notice Value of one whole token in settlement smallest units. Zero means
    ///         unpriceable.
    mapping(address asset => uint256 price) private _prices;

    /// @notice Whether a price has ever been set for an asset. Distinguishes
    ///         "not configured" from "deliberately cleared" in tooling.
    mapping(address asset => bool configured) public isConfigured;

    event PriceSet(address indexed asset, uint256 price);
    event PriceCleared(address indexed asset);

    error NotAdmin(address caller);
    error ZeroAddress(string field);

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress("admin");
        admin = admin_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    /// @notice Sets the price of one whole `asset` token.
    /// @param asset Token to price.
    /// @param price Value of one whole token in settlement smallest units. For a
    ///        token worth 175.42 units of an 18-decimal settlement asset, pass
    ///        `175.42e18`. Pass 0 to mark the asset unpriceable.
    function setPrice(address asset, uint256 price) external onlyAdmin {
        if (asset == address(0)) revert ZeroAddress("asset");
        _prices[asset] = price;
        isConfigured[asset] = true;
        emit PriceSet(asset, price);
    }

    /// @notice Sets several prices in one call, for seeding a demo.
    function setPrices(address[] calldata assets, uint256[] calldata prices) external onlyAdmin {
        uint256 length = assets.length;
        require(length == prices.length, "length mismatch");

        for (uint256 i; i < length; ++i) {
            if (assets[i] == address(0)) revert ZeroAddress("asset");
            _prices[assets[i]] = prices[i];
            isConfigured[assets[i]] = true;
            emit PriceSet(assets[i], prices[i]);
        }
    }

    /// @notice Marks an asset unpriceable without forgetting it was configured.
    function clearPrice(address asset) external onlyAdmin {
        _prices[asset] = 0;
        emit PriceCleared(asset);
    }

    /// @inheritdoc IPriceProvider
    function priceOf(address asset) external view returns (uint256 price) {
        return _prices[asset];
    }
}
