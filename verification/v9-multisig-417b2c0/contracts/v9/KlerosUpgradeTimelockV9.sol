// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Non-upgradeable project upgrade controller. No deployer administrator or emergency bypass.
contract KlerosUpgradeTimelockV9 is TimelockController {
    error InvalidProjectMultisig();
    error DelayBelowMinimum();
    uint256 public constant MIN_UPGRADE_DELAY = 48 hours;

    constructor(address projectMultisig)
        TimelockController(MIN_UPGRADE_DELAY, _single(projectMultisig), _single(address(0)), address(0))
    {
        require(projectMultisig.code.length > 0, InvalidProjectMultisig());
    }

    function _single(address account) private pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = account;
    }

    function updateDelay(uint256 newDelay) public override {
        require(newDelay >= MIN_UPGRADE_DELAY, DelayBelowMinimum());
        super.updateDelay(newDelay);
    }
}
