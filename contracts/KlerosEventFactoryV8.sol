// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {KlerosEventV8} from "./KlerosEventV8.sol";

/// @notice Immutable, permissionless deployment registry for isolated v8 events.
/// Event deposits go directly to the child. No administrator, upgrades, fees,
/// arbitrary executable code, delegatecalls or factory withdrawals exist.
contract KlerosEventFactoryV8 {
    error InvalidEventKey();
    error EventAlreadyExists(bytes32 eventId);
    error Reentrancy();
    error CodeTooLarge();
    error CodeStorageFailed();
    error EventDeploymentFailed();

    uint256 public constant VERSION = 8;
    uint256 private constant CHUNK_SIZE = 24_575;
    uint256 private constant MAX_INITCODE = 49_152;

    struct EventParameters {
        uint256 depositAmount;
        string eventName;
        uint256 eventStart;
        uint256 claimDeadline;
        KlerosEventV8.Arbitration arbitration;
    }

    /// @dev Compiler-fixed code is stored during construction, outside the factory
    /// runtime's code-size budget. STOP-prefixed blobs have no executable behavior.
    address public immutable creationCodeStore0;
    address public immutable creationCodeStore1;
    bytes32 public immutable creationCodeHash;
    uint256 public immutable creationCodeLength;

    mapping(bytes32 => address) public eventsById;
    mapping(address => bool) public isEvent;
    uint256 public eventCount;
    uint256 private _locked = 1;

    event EventCreated(
        bytes32 indexed eventId,
        address indexed creator,
        address indexed eventContract,
        bytes32 eventKey,
        uint256 version,
        bytes32 configurationHash
    );

    constructor() {
        bytes memory code = type(KlerosEventV8).creationCode;
        require(code.length <= 2 * CHUNK_SIZE, CodeTooLarge());
        creationCodeHash = keccak256(code);
        creationCodeLength = code.length;
        if (code.length <= CHUNK_SIZE) {
            creationCodeStore0 = _store(code);
            creationCodeStore1 = address(0);
        } else {
            creationCodeStore0 = _store(_slice(code, 0, CHUNK_SIZE));
            creationCodeStore1 = _store(_slice(code, CHUNK_SIZE, code.length - CHUNK_SIZE));
        }
    }

    /// @notice Keys are scoped to the authenticated creator, within this factory
    /// and chain. Copying another creator's key cannot occupy their event identity.
    function eventId(address creator, bytes32 eventKey) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, eventKey));
    }

    function eventFor(address creator, bytes32 eventKey) external view returns (address) {
        return eventsById[eventId(creator, eventKey)];
    }

    /// @notice Exact child creation code; callers cannot replace it.
    function eventCreationCode() public view returns (bytes memory) {
        return bytes.concat(_load(creationCodeStore0), _load(creationCodeStore1));
    }

    /// @notice Create a new event with msg.sender as its initial owner. The child
    /// and registry entry are created atomically. ETH is not accepted here.
    function createEvent(bytes32 eventKey, EventParameters calldata config) external returns (address child) {
        require(_locked == 1, Reentrancy());
        _locked = 2;
        require(eventKey != bytes32(0), InvalidEventKey());
        bytes32 id = eventId(msg.sender, eventKey);
        require(eventsById[id] == address(0), EventAlreadyExists(id));
        bytes memory init = bytes.concat(
            eventCreationCode(),
            abi.encode(config.depositAmount, config.eventName, msg.sender, config.eventStart, config.claimDeadline, config.arbitration)
        );
        require(init.length <= MAX_INITCODE, CodeTooLarge());
        assembly ("memory-safe") {
            child := create(0, add(init, 32), mload(init))
        }
        require(child != address(0), EventDeploymentFailed());
        eventsById[id] = child;
        isEvent[child] = true;
        eventCount += 1;
        emit EventCreated(id, msg.sender, child, eventKey, VERSION, keccak256(abi.encode(msg.sender, config)));
        _locked = 1;
    }

    function _store(bytes memory data) private returns (address store) {
        require(data.length <= CHUNK_SIZE, CodeTooLarge());
        // Ten bytes of init code, followed by STOP and the immutable payload.
        bytes memory init = bytes.concat(hex"61", bytes2(uint16(data.length + 1)), hex"80600a3d393df300", data);
        assembly ("memory-safe") {
            store := create(0, add(init, 32), mload(init))
        }
        require(store != address(0), CodeStorageFailed());
    }

    function _load(address store) private view returns (bytes memory data) {
        if (store == address(0)) return new bytes(0);
        uint256 size = store.code.length - 1;
        data = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(store, add(data, 32), 1, size)
        }
    }

    function _slice(bytes memory data, uint256 start, uint256 length) private pure returns (bytes memory out) {
        out = new bytes(length);
        for (uint256 i; i < length; ++i) out[i] = data[start + i];
    }
}
