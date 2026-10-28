// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentAccount} from "./AgentAccount.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title AgentAccountFactory
/// @notice Deploys a policy wallet for an ERC-8004 agent. Only the agent's current owner in the
///         Identity Registry can create one, so nobody can attach a wallet to an agent they do not own.
contract AgentAccountFactory {
    IIdentityRegistry public immutable identity;

    /// @notice The latest wallet created for an agent. Use `currentAccount` to check it still matches the owner.
    mapping(uint256 => address) public accountOf;

    event AccountCreated(uint256 indexed agentId, address indexed account, address indexed owner, address agent);

    error NotAgentOwner();

    constructor(IIdentityRegistry identity_) {
        identity = identity_;
    }

    function create(uint256 agentId, address agentKey) external returns (address account) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        account = address(new AgentAccount(msg.sender, agentKey, agentId));
        accountOf[agentId] = account;
        emit AccountCreated(agentId, account, msg.sender, agentKey);
    }

    /// @notice The agent's wallet, or zero if there is none or the agent changed hands since it was created.
    function currentAccount(uint256 agentId) external view returns (address) {
        address account = accountOf[agentId];
        if (account == address(0)) return address(0);
        if (AgentAccount(payable(account)).owner() != identity.ownerOf(agentId)) return address(0);
        return account;
    }
}
