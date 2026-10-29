// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {KlerosUpgradeTimelockV9} from "./KlerosUpgradeTimelockV9.sol";

interface IKlerosV9Implementation {
    function VERSION() external view returns (uint256);
    function UPGRADE_FAMILY() external view returns (bytes32);
    function implementationRevision() external view returns (uint256);
    function storageSchema() external view returns (bytes32);
    function proxiableUUID() external view returns (bytes32);
}

interface IKlerosV9UpgradeAuthority {
    function upgradeAuthority() external view returns (address);
}

interface IKlerosV9Timelock {
    function getMinDelay() external view returns (uint256);
    function MIN_UPGRADE_DELAY() external view returns (uint256);
}

/// @dev Common authorization only; organizer ownership never authorizes an upgrade.
abstract contract KlerosUpgradeGateV9 is Initializable, UUPSUpgradeable {
    error UnauthorizedUpgrade();
    error InvalidUpgradeAuthority();
    error InvalidImplementation();
    error WrongUpgradeFamily();
    error WrongStorageSchema();
    error InvalidImplementationRevision();
    error UpgradeWhileBusy();
    error UpgradeValueNotAllowed();

    uint256 internal constant UPGRADE_DELAY_FLOOR = 48 hours;
    bytes32 internal constant EVENT_FAMILY = keccak256("kleros.event.v9.uups");
    bytes32 internal constant FACTORY_FAMILY = keccak256("kleros.factory.v9.uups");
    bytes32 internal constant EVENT_SCHEMA = keccak256("kleros.event.v9.storage.1");
    bytes32 internal constant FACTORY_SCHEMA = keccak256("kleros.factory.v9.storage.1");
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @custom:storage-location erc7201:kleros.storage.UpgradeGateV9
    struct UpgradeGateStorage { address authority; }
    // keccak256(abi.encode(uint256(keccak256("kleros.storage.UpgradeGateV9")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant UPGRADE_GATE_STORAGE = 0xe52709d5d2584d7781be7bdd5de93156c9489d44a4f5977e28a0120cffd25300;
    bytes32 internal immutable _timelockCodeHash = keccak256(type(KlerosUpgradeTimelockV9).runtimeCode);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function _upgradeGateStorage() private pure returns (UpgradeGateStorage storage s) {
        bytes32 slot = UPGRADE_GATE_STORAGE;
        assembly ("memory-safe") { s.slot := slot }
    }

    function upgradeAuthority() public view returns (address) { return _upgradeGateStorage().authority; }

    function _initializeUpgradeAuthority(address authority) internal onlyInitializing {
        require(authority.code.length > 0 && authority.codehash == _timelockCodeHash, InvalidUpgradeAuthority());
        try IKlerosV9Timelock(authority).MIN_UPGRADE_DELAY() returns (uint256 floor) {
            require(floor == UPGRADE_DELAY_FLOOR, InvalidUpgradeAuthority());
        } catch { revert InvalidUpgradeAuthority(); }
        try IKlerosV9Timelock(authority).getMinDelay() returns (uint256 delay) {
            require(delay >= UPGRADE_DELAY_FLOOR, InvalidUpgradeAuthority());
        } catch { revert InvalidUpgradeAuthority(); }
        _upgradeGateStorage().authority = authority;
    }

    function implementationRevision() public pure virtual returns (uint256) { return 1; }
    function storageSchema() public pure virtual returns (bytes32);
    function _upgradeFamily() internal pure virtual returns (bytes32);
    function _upgradeIdle() internal view virtual returns (bool);

    function _validateImplementation(address candidate, bytes32 family, bytes32 schema, uint256 minimumRevision) internal view {
        require(candidate.code.length > 0 && candidate != address(this), InvalidImplementation());
        IKlerosV9Implementation next = IKlerosV9Implementation(candidate);
        require(next.VERSION() == 9, InvalidImplementation());
        require(next.UPGRADE_FAMILY() == family, WrongUpgradeFamily());
        require(next.storageSchema() == schema, WrongStorageSchema());
        require(next.implementationRevision() >= minimumRevision, InvalidImplementationRevision());
        require(next.proxiableUUID() == IMPLEMENTATION_SLOT, InvalidImplementation());
    }

    function _authorizeUpgrade(address candidate) internal view override {
        require(msg.sender == upgradeAuthority(), UnauthorizedUpgrade());
        require(_upgradeIdle(), UpgradeWhileBusy());
        _validateImplementation(candidate, _upgradeFamily(), storageSchema(), implementationRevision() + 1);
    }

    function upgradeToAndCall(address candidate, bytes memory data) public payable virtual override {
        require(msg.value == 0, UpgradeValueNotAllowed());
        super.upgradeToAndCall(candidate, data);
    }
}
