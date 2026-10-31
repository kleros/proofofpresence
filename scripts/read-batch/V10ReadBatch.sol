// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Creation bytecode used only by eth_call, without a recipient or deployment.
/// Calls are static; code mode reads the target's existing EXTCODEHASH.
contract V10ReadBatch {
    error InvalidBatch();
    error ReadFailed(uint256 index);
    error ReturnLimit(uint256 index);

    constructor(address[] memory targets, bytes[] memory inputs, bool codeOnly) {
        uint256 count = targets.length;
        if (count == 0 || count > 64 || (codeOnly ? inputs.length != 0 : inputs.length != count)) revert InvalidBatch();
        bytes[] memory results = new bytes[](count);
        uint256 totalInput;
        uint256 totalReturn;
        for (uint256 i; i < count; ++i) {
            address target = targets[i];
            bytes memory result;
            if (codeOnly) {
                result = abi.encode(target.codehash);
            } else {
                bytes memory input = inputs[i];
                totalInput += input.length;
                if (input.length > 4_096 || totalInput > 32_768 || target.code.length == 0) revert InvalidBatch();
                bool success;
                uint256 size;
                assembly ("memory-safe") {
                    success := staticcall(2000000, target, add(input, 32), mload(input), 0, 0)
                    size := returndatasize()
                }
                if (!success) revert ReadFailed(i);
                if (size > 65_536) revert ReturnLimit(i);
                result = new bytes(size);
                assembly ("memory-safe") { returndatacopy(add(result, 32), 0, size) }
            }
            totalReturn += result.length;
            if (totalReturn > 524_288) revert ReturnLimit(i);
            results[i] = result;
        }
        bytes memory encoded = abi.encode(results);
        assembly ("memory-safe") { return(add(encoded, 32), mload(encoded)) }
    }
}
