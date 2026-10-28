// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title AgentValidation
/// @notice Bonded validators check one claim about one ERC-8004 agent and stake tokens on the answer.
///         A missed deadline is slashed by anyone; a false answer is slashed after an upheld challenge.
///         All parameters are fixed at deploy. There is no owner and no upgrade path.
///         Design: docs/validators.md. Not audited.
contract AgentValidation is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant VALIDATOR_BPS = 8_000;
    uint256 public constant BURN_BPS = 1_500;
    // the remaining 500 bps of each fee go to the treasury

    IERC20 public immutable token;
    IIdentityRegistry public immutable identity;
    address public immutable arbiter;
    address public immutable treasury;

    uint256 public immutable minBond;
    uint256 public immutable missPenalty;
    uint256 public immutable fraudPenalty;
    uint256 public immutable challengeBond;
    uint64 public immutable acceptWindow;
    uint64 public immutable responseWindow;
    uint64 public immutable challengeWindow;
    uint64 public immutable unbondDelay;
    uint64 public immutable validity;

    struct Params {
        uint256 minBond;
        uint256 missPenalty;
        uint256 fraudPenalty;
        uint256 challengeBond;
        uint64 acceptWindow;
        uint64 responseWindow;
        uint64 challengeWindow;
        uint64 unbondDelay;
        uint64 validity;
    }

    struct Validator {
        uint256 bonded; // active bond, slashable
        uint256 locked; // part of `bonded` held by open checks
        uint256 unbonding; // waiting for `unbondAt`, still slashable
        uint64 unbondAt;
    }

    enum Status {
        None,
        Requested,
        Accepted,
        Responded,
        Challenged,
        Finalized,
        Cancelled,
        Missed,
        Overturned
    }

    struct Check {
        uint256 agentId;
        bytes32 claimType;
        address owner;
        address validator;
        address challenger;
        uint256 fee;
        bytes32 evidenceHash;
        uint64 deadline; // accept, response or challenge deadline, depending on status
        uint64 respondedAt;
        bool passed;
        Status status;
    }

    mapping(address => Validator) public validators;
    mapping(uint256 => Check) public checks;
    uint256 public nextCheckId = 1;

    /// @notice A passing, unchallenged answer counts until `validity` after it was given. A newer finalized
    ///         failure resets it to zero. Only the most recently answered check sets the badge, whatever
    ///         order checks are finalized in.
    mapping(uint256 => mapping(bytes32 => uint64)) public verifiedUntil;
    mapping(uint256 => mapping(bytes32 => uint256)) public latestCheck;
    mapping(uint256 => mapping(bytes32 => uint64)) public latestRespondedAt;

    event Bonded(address indexed validator, uint256 amount);
    event UnbondRequested(address indexed validator, uint256 amount, uint64 unbondAt);
    event Withdrawn(address indexed validator, uint256 amount);
    event Requested(uint256 indexed checkId, uint256 indexed agentId, bytes32 indexed claimType, address owner, address validator, uint256 fee);
    event Cancelled(uint256 indexed checkId);
    event Accepted(uint256 indexed checkId, uint64 respondBy);
    event Responded(uint256 indexed checkId, bool passed, bytes32 evidenceHash, string evidenceURI, uint64 challengeBy);
    event Challenged(uint256 indexed checkId, address indexed challenger);
    event Finalized(uint256 indexed checkId, bool passed, uint256 toValidator, uint256 burned, uint256 toTreasury);
    event Missed(uint256 indexed checkId, uint256 penalty);
    event Overturned(uint256 indexed checkId, uint256 penalty);
    event ChallengeRejected(uint256 indexed checkId);

    error NotAgentOwner();
    error BadParams();
    error BadStatus();
    error NotValidator();
    error NotArbiter();
    error TooEarly();
    error TooLate();
    error InsufficientBond();
    error NothingToWithdraw();

    constructor(IERC20 token_, IIdentityRegistry identity_, address arbiter_, address treasury_, Params memory p) {
        if (address(token_) == address(0) || address(identity_) == address(0) || arbiter_ == address(0) || treasury_ == address(0)) revert BadParams();
        if (p.minBond < p.fraudPenalty || p.fraudPenalty < p.missPenalty || p.missPenalty == 0) revert BadParams();
        if (p.acceptWindow == 0 || p.responseWindow == 0 || p.challengeWindow == 0 || p.validity == 0) revert BadParams();
        token = token_;
        identity = identity_;
        arbiter = arbiter_;
        treasury = treasury_;
        minBond = p.minBond;
        missPenalty = p.missPenalty;
        fraudPenalty = p.fraudPenalty;
        challengeBond = p.challengeBond;
        acceptWindow = p.acceptWindow;
        responseWindow = p.responseWindow;
        challengeWindow = p.challengeWindow;
        unbondDelay = p.unbondDelay;
        validity = p.validity;
    }

    // ---------------------------------------------------------------- bonds

    function bond(uint256 amount) external nonReentrant {
        validators[msg.sender].bonded += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Bonded(msg.sender, amount);
    }

    /// @notice Moves unlocked bond into the unbonding queue. It stays slashable until withdrawn.
    function requestUnbond(uint256 amount) external {
        Validator storage v = validators[msg.sender];
        if (amount == 0 || amount > v.bonded - v.locked) revert InsufficientBond();
        v.bonded -= amount;
        v.unbonding += amount;
        v.unbondAt = uint64(block.timestamp) + unbondDelay;
        emit UnbondRequested(msg.sender, amount, v.unbondAt);
    }

    function withdraw() external nonReentrant {
        Validator storage v = validators[msg.sender];
        if (v.unbonding == 0) revert NothingToWithdraw();
        if (block.timestamp < v.unbondAt) revert TooEarly();
        uint256 amount = v.unbonding;
        v.unbonding = 0;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- checks

    function request(uint256 agentId, bytes32 claimType, address validator, uint256 fee) external nonReentrant returns (uint256 checkId) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (validator == address(0) || validator == msg.sender || fee == 0) revert BadParams();
        checkId = nextCheckId++;
        checks[checkId] = Check({
            agentId: agentId,
            claimType: claimType,
            owner: msg.sender,
            validator: validator,
            challenger: address(0),
            fee: fee,
            evidenceHash: bytes32(0),
            deadline: uint64(block.timestamp) + acceptWindow,
            respondedAt: 0,
            passed: false,
            status: Status.Requested
        });
        token.safeTransferFrom(msg.sender, address(this), fee);
        emit Requested(checkId, agentId, claimType, msg.sender, validator, fee);
    }

    /// @notice The owner can withdraw a request the validator has not accepted.
    function cancel(uint256 checkId) external nonReentrant {
        Check storage c = checks[checkId];
        if (c.status != Status.Requested) revert BadStatus();
        if (msg.sender != c.owner) revert NotAgentOwner();
        c.status = Status.Cancelled;
        token.safeTransfer(c.owner, c.fee);
        emit Cancelled(checkId);
    }

    function accept(uint256 checkId) external {
        Check storage c = checks[checkId];
        if (c.status != Status.Requested) revert BadStatus();
        if (msg.sender != c.validator) revert NotValidator();
        if (block.timestamp > c.deadline) revert TooLate();
        Validator storage v = validators[msg.sender];
        if (v.bonded < minBond || v.bonded - v.locked < fraudPenalty) revert InsufficientBond();
        v.locked += fraudPenalty;
        c.deadline = uint64(block.timestamp) + responseWindow;
        c.status = Status.Accepted;
        emit Accepted(checkId, c.deadline);
    }

    function respond(uint256 checkId, bool passed, bytes32 evidenceHash, string calldata evidenceURI) external {
        Check storage c = checks[checkId];
        if (c.status != Status.Accepted) revert BadStatus();
        if (msg.sender != c.validator) revert NotValidator();
        if (block.timestamp > c.deadline) revert TooLate();
        c.passed = passed;
        c.evidenceHash = evidenceHash;
        c.respondedAt = uint64(block.timestamp);
        c.deadline = uint64(block.timestamp) + challengeWindow;
        c.status = Status.Responded;
        emit Responded(checkId, passed, evidenceHash, evidenceURI, c.deadline);
    }

    /// @notice Anyone can slash a validator that accepted a check and let the response deadline pass.
    function slashMissed(uint256 checkId) external nonReentrant {
        Check storage c = checks[checkId];
        if (c.status != Status.Accepted) revert BadStatus();
        if (block.timestamp <= c.deadline) revert TooEarly();
        c.status = Status.Missed;
        Validator storage v = validators[c.validator];
        v.locked -= fraudPenalty;
        uint256 taken = _take(v, missPenalty);
        uint256 toOwner = taken / 2;
        token.safeTransfer(c.owner, c.fee + toOwner);
        token.safeTransfer(BURN, taken - toOwner);
        emit Missed(checkId, taken);
    }

    function challenge(uint256 checkId) external nonReentrant {
        Check storage c = checks[checkId];
        if (c.status != Status.Responded) revert BadStatus();
        if (block.timestamp > c.deadline) revert TooLate();
        if (msg.sender == c.validator) revert BadParams();
        c.challenger = msg.sender;
        c.status = Status.Challenged;
        token.safeTransferFrom(msg.sender, address(this), challengeBond);
        emit Challenged(checkId, msg.sender);
    }

    /// @notice v1 disputes are decided by the arbiter (a Safe). It can only pick a side for a challenged check.
    function resolve(uint256 checkId, bool validatorWasRight) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Check storage c = checks[checkId];
        if (c.status != Status.Challenged) revert BadStatus();
        if (validatorWasRight) {
            uint256 toValidator = challengeBond / 2;
            _settle(checkId, c);
            token.safeTransfer(c.validator, toValidator);
            token.safeTransfer(BURN, challengeBond - toValidator);
            emit ChallengeRejected(checkId);
        } else {
            c.status = Status.Overturned;
            Validator storage v = validators[c.validator];
            v.locked -= fraudPenalty;
            uint256 taken = _take(v, fraudPenalty);
            uint256 toChallenger = taken / 2;
            token.safeTransfer(c.owner, c.fee);
            token.safeTransfer(c.challenger, challengeBond + toChallenger);
            token.safeTransfer(BURN, taken - toChallenger);
            emit Overturned(checkId, taken);
        }
    }

    /// @notice Anyone can finalize an unchallenged answer once the challenge window has closed.
    function finalize(uint256 checkId) external nonReentrant {
        Check storage c = checks[checkId];
        if (c.status != Status.Responded) revert BadStatus();
        if (block.timestamp <= c.deadline) revert TooEarly();
        _settle(checkId, c);
    }

    // ---------------------------------------------------------------- views

    function isVerified(uint256 agentId, bytes32 claimType) external view returns (bool) {
        return verifiedUntil[agentId][claimType] > block.timestamp;
    }

    function available(address validator) external view returns (uint256) {
        Validator storage v = validators[validator];
        return v.bonded - v.locked;
    }

    // ---------------------------------------------------------------- internal

    function _settle(uint256 checkId, Check storage c) internal {
        c.status = Status.Finalized;
        validators[c.validator].locked -= fraudPenalty;
        uint256 burned = (c.fee * BURN_BPS) / BPS;
        uint256 toValidator = (c.fee * VALIDATOR_BPS) / BPS;
        uint256 toTreasury = c.fee - burned - toValidator;
        if (c.respondedAt >= latestRespondedAt[c.agentId][c.claimType]) {
            latestRespondedAt[c.agentId][c.claimType] = c.respondedAt;
            latestCheck[c.agentId][c.claimType] = checkId;
            verifiedUntil[c.agentId][c.claimType] = c.passed ? c.respondedAt + validity : 0;
        }
        token.safeTransfer(c.validator, toValidator);
        token.safeTransfer(BURN, burned);
        token.safeTransfer(treasury, toTreasury);
        emit Finalized(checkId, c.passed, toValidator, burned, toTreasury);
    }

    /// @dev Takes up to `amount` from the active bond first, then from the unbonding queue.
    function _take(Validator storage v, uint256 amount) internal returns (uint256 taken) {
        uint256 fromBond = amount <= v.bonded ? amount : v.bonded;
        v.bonded -= fromBond;
        uint256 rest = amount - fromBond;
        uint256 fromQueue = rest <= v.unbonding ? rest : v.unbonding;
        v.unbonding -= fromQueue;
        taken = fromBond + fromQueue;
    }
}
