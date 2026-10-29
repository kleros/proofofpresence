// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {KlerosUpgradeControllerV10} from "./KlerosUpgradeControllerV10.sol";

interface IKlerosV10Implementation {
    function VERSION() external view returns (uint256);
    function UPGRADE_FAMILY() external view returns (bytes32);
    function implementationRevision() external view returns (uint256);
    function storageSchema() external view returns (bytes32);
    function proxiableUUID() external view returns (bytes32);
}

interface IKlerosV10UpgradeAuthority {
    function upgradeAuthority() external view returns (address);
}

interface IKlerosV10Controller {
    function upgradesDisabled() external view returns (bool);
}

/// @dev Common authorization only; organizer ownership never authorizes an upgrade.
abstract contract KlerosUpgradeGateV10 is Initializable, UUPSUpgradeable {
    error UnauthorizedUpgrade();
    error InvalidUpgradeAuthority();
    error InvalidImplementation();
    error WrongUpgradeFamily();
    error WrongStorageSchema();
    error InvalidImplementationRevision();
    error UpgradeWhileBusy();
    error UpgradeValueNotAllowed();
    error UpgradesPermanentlyDisabled();

    bytes32 internal constant EVENT_FAMILY = keccak256("kleros.event.v10.uups");
    bytes32 internal constant FACTORY_FAMILY = keccak256("kleros.factory.v10.uups");
    bytes32 internal constant EVENT_SCHEMA = keccak256("kleros.event.v10.storage.1");
    bytes32 internal constant FACTORY_SCHEMA = keccak256("kleros.factory.v10.storage.1");
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @custom:storage-location erc7201:kleros.storage.UpgradeGateV10
    struct UpgradeGateStorage { address authority; }
    // keccak256(abi.encode(uint256(keccak256("kleros.storage.UpgradeGateV10")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant UPGRADE_GATE_STORAGE = 0x44131f48368e8020ccc00b32733603157db6423acbf8aba15dd4dc680dfaa300;
    bytes32 internal immutable _controllerCodeHash = keccak256(type(KlerosUpgradeControllerV10).runtimeCode);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function _upgradeGateStorage() private pure returns (UpgradeGateStorage storage s) {
        bytes32 slot = UPGRADE_GATE_STORAGE;
        assembly ("memory-safe") { s.slot := slot }
    }

    function upgradeAuthority() public view returns (address) { return _upgradeGateStorage().authority; }

    function _initializeUpgradeAuthority(address authority) internal onlyInitializing {
        require(authority.code.length > 0 && authority.codehash == _controllerCodeHash, InvalidUpgradeAuthority());
        _upgradeGateStorage().authority = authority;
    }

    function implementationRevision() public pure virtual returns (uint256) { return 1; }
    function storageSchema() public pure virtual returns (bytes32);
    function _upgradeFamily() internal pure virtual returns (bytes32);
    function _upgradeIdle() internal view virtual returns (bool);

    function _validateImplementation(address candidate, bytes32 family, bytes32 schema, uint256 minimumRevision) internal view {
        require(candidate.code.length > 0 && candidate != address(this), InvalidImplementation());
        IKlerosV10Implementation next = IKlerosV10Implementation(candidate);
        require(next.VERSION() == 10, InvalidImplementation());
        require(next.UPGRADE_FAMILY() == family, WrongUpgradeFamily());
        require(next.storageSchema() == schema, WrongStorageSchema());
        require(next.implementationRevision() >= minimumRevision, InvalidImplementationRevision());
        require(next.proxiableUUID() == IMPLEMENTATION_SLOT, InvalidImplementation());
    }

    function _requireUpgradeAuthority() internal view {
        address authority = upgradeAuthority();
        require(msg.sender == authority, UnauthorizedUpgrade());
        require(!IKlerosV10Controller(authority).upgradesDisabled(), UpgradesPermanentlyDisabled());
    }

    function _authorizeUpgrade(address candidate) internal view override {
        _requireUpgradeAuthority();
        require(_upgradeIdle(), UpgradeWhileBusy());
        _validateImplementation(candidate, _upgradeFamily(), storageSchema(), implementationRevision() + 1);
    }

    function upgradeToAndCall(address candidate, bytes memory data) public payable virtual override {
        require(msg.value == 0, UpgradeValueNotAllowed());
        super.upgradeToAndCall(candidate, data);
    }
}
