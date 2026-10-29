// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IKlerosV10ControlledProxy {
    function VERSION() external view returns (uint256);
    function UPGRADE_FAMILY() external view returns (bytes32);
    function upgradeAuthority() external view returns (address);
    function upgradeToAndCall(address implementation, bytes calldata data) external payable;
    function setEventImplementation(address implementation) external;
}

/// @notice Immediate owner-controlled upgrades. Renouncing permanently disables every forwarding path.
/// This controller is not a proxy and has no alternate administrator or recovery capability.
contract KlerosUpgradeControllerV10 is Ownable2Step {
    error ControllerBusy();
    error InvalidUpgradeOwner();
    error NoPendingOwnershipTransfer();
    error InvalidControlledTarget();

    uint256 public constant VERSION = 10;
    uint256 public constant UPGRADE_DELAY_SECONDS = 0;
    bytes32 private constant EVENT_FAMILY = keccak256("kleros.event.v10.uups");
    bytes32 private constant FACTORY_FAMILY = keccak256("kleros.factory.v10.uups");
    uint256 private _locked;

    event UpgradeForwarded(address indexed proxy, address indexed implementation);
    event EventImplementationForwarded(address indexed factory, address indexed implementation);

    constructor(address initialOwner) Ownable(initialOwner) {
        require(initialOwner != address(this), InvalidUpgradeOwner());
        _locked = 1;
    }

    modifier whileIdle() {
        require(_locked == 1, ControllerBusy());
        _locked = 2;
        _;
        _locked = 1;
    }

    function upgradesDisabled() public view returns (bool) { return owner() == address(0); }

    function _controlledTarget(address target, bool factoryOnly) private view returns (IKlerosV10ControlledProxy proxy) {
        require(target.code.length > 0, InvalidControlledTarget());
        proxy = IKlerosV10ControlledProxy(target);
        require(proxy.VERSION() == VERSION && proxy.upgradeAuthority() == address(this), InvalidControlledTarget());
        bytes32 family = proxy.UPGRADE_FAMILY();
        require(family == FACTORY_FAMILY || (!factoryOnly && family == EVENT_FAMILY), InvalidControlledTarget());
    }

    function upgrade(address proxy, address implementation, bytes calldata data) external onlyOwner whileIdle {
        _controlledTarget(proxy, false).upgradeToAndCall(implementation, data);
        emit UpgradeForwarded(proxy, implementation);
    }

    function setEventImplementation(address factory, address implementation) external onlyOwner whileIdle {
        _controlledTarget(factory, true).setEventImplementation(implementation);
        emit EventImplementationForwarded(factory, implementation);
    }

    function transferOwnership(address newOwner) public override onlyOwner whileIdle {
        require(newOwner != address(0) && newOwner != address(this) && newOwner != owner(), InvalidUpgradeOwner());
        super.transferOwnership(newOwner);
    }

    function acceptOwnership() public override whileIdle { super.acceptOwnership(); }

    function cancelOwnershipTransfer() external onlyOwner whileIdle {
        require(pendingOwner() != address(0), NoPendingOwnershipTransfer());
        super.transferOwnership(address(0));
    }

    function renounceOwnership() public override onlyOwner whileIdle { super.renounceOwnership(); }
}
