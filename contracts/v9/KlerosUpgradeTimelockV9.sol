// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice One transferable upgrade owner; every governed action retains the permanent 48-hour floor.
/// No deployer administrator, alternate proposer or emergency bypass exists.
contract KlerosUpgradeTimelockV9 is TimelockController, Ownable2Step {
    error InvalidUpgradeOwner();
    error DelayBelowMinimum();
    error RoleManagementDisabled();
    error OwnershipRenunciationDisabled();
    error NoPendingOwnershipTransfer();
    error OwnershipTransferBlocked();
    error EmptyOperation();
    uint256 public constant MIN_UPGRADE_DELAY = 48 hours;
    uint256 public pendingOperationCount;
    uint256 public executingOperationCount;

    constructor(address initialOwner)
        TimelockController(MIN_UPGRADE_DELAY, _single(initialOwner), _single(address(0)), address(0))
        Ownable(initialOwner)
    {
        require(initialOwner != address(this), InvalidUpgradeOwner());
    }

    function _single(address account) private pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = account;
    }

    function updateDelay(uint256 newDelay) public override {
        require(newDelay >= MIN_UPGRADE_DELAY, DelayBelowMinimum());
        super.updateDelay(newDelay);
    }

    /// @notice Pending owners can cancel old operations, but cannot propose or accept a loaded queue.
    function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0) && newOwner != address(this) && newOwner != owner(), InvalidUpgradeOwner());
        address previousPending = pendingOwner();
        if (previousPending != address(0)) _revokeRole(CANCELLER_ROLE, previousPending);
        super.transferOwnership(newOwner);
        _grantRole(CANCELLER_ROLE, newOwner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        address previousPending = pendingOwner();
        require(previousPending != address(0), NoPendingOwnershipTransfer());
        _revokeRole(CANCELLER_ROLE, previousPending);
        super.transferOwnership(address(0));
    }

    /// @notice No old queued or currently executing action may survive an accepted handover.
    function acceptOwnership() public override {
        address nextOwner = pendingOwner();
        if (_msgSender() != nextOwner) revert OwnableUnauthorizedAccount(_msgSender());
        require(pendingOperationCount == 0 && executingOperationCount == 0, OwnershipTransferBlocked());
        address previousOwner = owner();
        _revokeRole(PROPOSER_ROLE, previousOwner);
        _revokeRole(CANCELLER_ROLE, previousOwner);
        super.acceptOwnership();
        _grantRole(PROPOSER_ROLE, nextOwner);
        _grantRole(CANCELLER_ROLE, nextOwner);
    }

    function renounceOwnership() public pure override { revert OwnershipRenunciationDisabled(); }
    function grantRole(bytes32, address) public pure override { revert RoleManagementDisabled(); }
    function revokeRole(bytes32, address) public pure override { revert RoleManagementDisabled(); }
    function renounceRole(bytes32, address) public pure override { revert RoleManagementDisabled(); }

    function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)
        public override
    {
        super.schedule(target, value, data, predecessor, salt, delay);
        pendingOperationCount += 1;
    }

    function scheduleBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata payloads,
        bytes32 predecessor, bytes32 salt, uint256 delay) public override
    {
        require(targets.length > 0, EmptyOperation());
        super.scheduleBatch(targets, values, payloads, predecessor, salt, delay);
        pendingOperationCount += 1;
    }

    function cancel(bytes32 id) public override {
        super.cancel(id);
        pendingOperationCount -= 1;
    }

    function execute(address target, uint256 value, bytes calldata payload, bytes32 predecessor, bytes32 salt)
        public payable override
    {
        executingOperationCount += 1;
        super.execute(target, value, payload, predecessor, salt);
        executingOperationCount -= 1;
        pendingOperationCount -= 1;
    }

    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata payloads,
        bytes32 predecessor, bytes32 salt) public payable override
    {
        require(targets.length > 0, EmptyOperation());
        executingOperationCount += 1;
        super.executeBatch(targets, values, payloads, predecessor, salt);
        executingOperationCount -= 1;
        pendingOperationCount -= 1;
    }
}
