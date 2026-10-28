// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @dev Synthetic stress fixture only; never deployed by the application/factory.
contract StressWallet {
    enum Mode { Accept, Refuse, Burn, ReturnBomb, RevertBomb, Reenter }
    address public immutable controller = msg.sender;
    Mode public mode;
    address public callbackTarget;
    bytes public callbackData;
    uint256 public callbackValue;
    bool public callbackOK = true;
    bytes4 public callbackSelector = 0xffffffff;
    // Sentinels keep every callback result in an already-nonzero packed slot.
    uint64 public callbackAttempts = 1;
    uint64 public blockedCallbacks = 1;
    uint64 public successfulCallbacks = 1;
    uint256 public calls = 1;

    function configure(Mode mode_, address target_, bytes calldata data_, uint256 value_) external {
        require(msg.sender == controller);
        mode = mode_;
        callbackTarget = target_;
        callbackData = data_;
        callbackValue = value_;
        callbackOK = true;
        callbackSelector = 0xffffffff;
        callbackAttempts = 1;
        blockedCallbacks = 1;
        successfulCallbacks = 1;
        calls = 1;
    }

    function execute(address target, bytes calldata data) external payable returns (bytes memory result) {
        require(msg.sender == controller);
        bool ok;
        (ok, result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
    }

    receive() external payable {
        Mode selected = mode;
        if (selected == Mode.Refuse) revert("synthetic refusal");
        if (selected == Mode.Burn) assembly { invalid() }
        // 32 KiB is affordable within the recipient gas allowance. The caller
        // must not copy it; success and revert payloads exercise both paths.
        if (selected == Mode.ReturnBomb) assembly { return(0, 32768) }
        if (selected == Mode.RevertBomb) assembly { revert(0, 32768) }
        if (selected == Mode.Reenter) {
            (bool ok, bytes memory result) = callbackTarget.call{value: callbackValue}(callbackData);
            callbackOK = ok;
            bytes4 selector;
            if (result.length >= 4) assembly { selector := mload(add(result, 32)) }
            callbackSelector = selector;
            callbackAttempts += 1;
            if (ok) successfulCallbacks += 1;
            else if (selector == bytes4(keccak256("Reentrancy()"))) blockedCallbacks += 1;
        }
        calls += 1;
    }
}

/// @dev Sends ETH without executing the recipient's deposit/receive code.
contract ForcedEther {
    constructor() payable {}
    function force(address payable to) external { selfdestruct(to); }
}
