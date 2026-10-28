// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The part of the ERC-8004 Identity Registry these contracts read: agents are ERC-721 tokens.
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}
