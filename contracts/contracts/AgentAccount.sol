// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentAccount
/// @notice A wallet an AI agent can pay from, within limits set by its owner and readable by anyone.
///         The agent key can only make payments: ETH or ERC-20, each checked against a per-payment
///         limit, a daily limit (UTC day) and an optional allowlist. An asset with no limits set is
///         blocked. The owner is never limited. Design: docs/policies.md. Not audited.
contract AgentAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ETH is tracked as this asset address.
    address public constant ETH = address(0);

    address public immutable owner;
    uint256 public immutable agentId;
    address public agent;
    bool public paused;
    bool public allowlistEnabled;

    struct Limits {
        uint128 perPayment;
        uint128 perDay;
    }

    mapping(address => Limits) public limits;
    mapping(address => mapping(uint256 => uint256)) public spentOnDay; // asset => UTC day => amount
    mapping(address => bool) public allowed;
    uint256 public allowedCount;

    event Paid(address indexed asset, address indexed to, uint256 amount, uint256 spentToday);
    event LimitsSet(address indexed asset, uint128 perPayment, uint128 perDay);
    event AllowedSet(address indexed account, bool allowed);
    event AllowlistEnabled(bool enabled);
    event AgentSet(address indexed agent);
    event PausedSet(bool paused);
    event Withdrawn(address indexed asset, address indexed to, uint256 amount);
    event Executed(address indexed target, uint256 value, bytes data);

    error NotOwner();
    error NotAgent();
    error IsPaused();
    error ZeroAddress();
    error NotAllowed();
    error OverPaymentLimit();
    error OverDailyLimit();
    error BadLimits();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address owner_, address agent_, uint256 agentId_) {
        if (owner_ == address(0) || agent_ == address(0)) revert ZeroAddress();
        owner = owner_;
        agent = agent_;
        agentId = agentId_;
        emit AgentSet(agent_);
    }

    receive() external payable {}

    // ---------------------------------------------------------------- agent

    function payETH(address payable to, uint256 amount) external onlyAgent nonReentrant {
        _spend(ETH, to, amount);
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function pay(IERC20 token, address to, uint256 amount) external onlyAgent nonReentrant {
        if (address(token) == ETH) revert ZeroAddress();
        _spend(address(token), to, amount);
        token.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Sets the agent's limits for one asset. Both zero blocks the asset.
    function setLimits(address asset, uint128 perPayment, uint128 perDay) external onlyOwner {
        if (perPayment > perDay) revert BadLimits();
        limits[asset] = Limits(perPayment, perDay);
        emit LimitsSet(asset, perPayment, perDay);
    }

    function setAllowed(address account, bool isAllowed) external onlyOwner {
        if (allowed[account] == isAllowed) return;
        allowed[account] = isAllowed;
        if (isAllowed) allowedCount++;
        else allowedCount--;
        emit AllowedSet(account, isAllowed);
    }

    function setAllowlistEnabled(bool enabled) external onlyOwner {
        allowlistEnabled = enabled;
        emit AllowlistEnabled(enabled);
    }

    /// @notice Rotates the agent key, for example after a leak.
    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAddress();
        agent = agent_;
        emit AgentSet(agent_);
    }

    /// @notice Kill switch: stops every agent payment until unpaused.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function withdraw(address asset, address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (asset == ETH) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Withdrawn(asset, to, amount);
    }

    /// @notice The owner can use the wallet directly. Not available to the agent.
    function execute(address target, uint256 value, bytes calldata data) external onlyOwner nonReentrant returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(target, value, data);
    }

    // ---------------------------------------------------------------- views

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function spentToday(address asset) external view returns (uint256) {
        return spentOnDay[asset][today()];
    }

    /// @notice How much the agent can still pay in `asset` today, ignoring the per-payment limit.
    function remainingToday(address asset) external view returns (uint256) {
        uint256 cap = limits[asset].perDay;
        uint256 spent = spentOnDay[asset][today()];
        return spent >= cap ? 0 : cap - spent;
    }

    // ---------------------------------------------------------------- internal

    function _spend(address asset, address to, uint256 amount) internal {
        if (paused) revert IsPaused();
        if (to == address(0)) revert ZeroAddress();
        if (allowlistEnabled && !allowed[to]) revert NotAllowed();
        Limits memory l = limits[asset];
        if (amount == 0 || amount > l.perPayment) revert OverPaymentLimit();
        uint256 day = today();
        uint256 spent = spentOnDay[asset][day] + amount;
        if (spent > l.perDay) revert OverDailyLimit();
        spentOnDay[asset][day] = spent;
        emit Paid(asset, to, amount, spent);
    }
}
