// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KlerosUpgradeGateV10} from "./KlerosUpgradeGateV10.sol";
import {KlerosEventV10} from "./KlerosEventV10.sol";

/// @notice Permissionless event creation; each child has its own ERC1967 implementation slot.
/// The transferable project controller governs immediate upgrades until renunciation. Factory defaults affect future children only.
contract KlerosEventFactoryV10 is KlerosUpgradeGateV10 {
    error InvalidEventKey();
    error EventAlreadyExists(bytes32 eventId);
    error Reentrancy();

    uint256 public constant VERSION = 10;
    bytes32 public constant UPGRADE_FAMILY = keccak256("kleros.factory.v10.uups");

    struct EventParameters {
        uint256 depositAmount;
        string eventName;
        uint256 eventStart;
        uint256 claimDeadline;
        KlerosEventV10.Arbitration arbitration;
    }

    address public eventImplementation;
    mapping(bytes32 => address) public eventsById;
    mapping(address => bool) public isEvent;
    uint256 public eventCount;
    uint256 private _locked;

    event EventCreated(bytes32 indexed eventId, address indexed creator, address indexed eventContract,
        bytes32 eventKey, uint256 version, bytes32 configurationHash);
    event EventImplementationSelected(address indexed implementation, bytes32 codeHash, uint256 revision);

    function initialize(address eventImplementation_, address upgradeAuthority_) external initializer {
        _locked = 2;
        _initializeUpgradeAuthority(upgradeAuthority_);
        _validateImplementation(eventImplementation_, EVENT_FAMILY, EVENT_SCHEMA, 1);
        eventImplementation = eventImplementation_;
        _locked = 1;
        emit EventImplementationSelected(eventImplementation_, eventImplementation_.codehash,
            KlerosEventV10(payable(eventImplementation_)).implementationRevision());
    }

    function storageSchema() public pure virtual override returns (bytes32) { return FACTORY_SCHEMA; }
    function _upgradeFamily() internal pure override returns (bytes32) { return UPGRADE_FAMILY; }
    function _upgradeIdle() internal view override returns (bool) { return _locked == 1; }
    function proxyCreationCodeHash() public pure returns (bytes32) { return keccak256(type(ERC1967Proxy).creationCode); }

    function setEventImplementation(address implementation_) external {
        _requireUpgradeAuthority();
        require(_locked == 1, Reentrancy());
        _locked = 2;
        _validateImplementation(implementation_, EVENT_FAMILY, EVENT_SCHEMA,
            KlerosEventV10(payable(eventImplementation)).implementationRevision() + 1);
        eventImplementation = implementation_;
        emit EventImplementationSelected(implementation_, implementation_.codehash,
            KlerosEventV10(payable(implementation_)).implementationRevision());
        _locked = 1;
    }

    function eventId(address creator, bytes32 eventKey) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, eventKey));
    }

    function eventFor(address creator, bytes32 eventKey) external view returns (address) {
        return eventsById[eventId(creator, eventKey)];
    }

    function createEvent(bytes32 eventKey, EventParameters calldata config) external returns (address child) {
        require(_locked == 1, Reentrancy());
        _locked = 2;
        require(eventKey != bytes32(0), InvalidEventKey());
        bytes32 id = eventId(msg.sender, eventKey);
        require(eventsById[id] == address(0), EventAlreadyExists(id));
        bytes memory data = abi.encodeCall(KlerosEventV10.initialize, (
            config.depositAmount, config.eventName, msg.sender, config.eventStart,
            config.claimDeadline, config.arbitration, address(this)
        ));
        child = address(new ERC1967Proxy(eventImplementation, data));
        eventsById[id] = child;
        isEvent[child] = true;
        eventCount += 1;
        emit EventCreated(id, msg.sender, child, eventKey, VERSION, keccak256(abi.encode(msg.sender, config)));
        _locked = 1;
    }
}
