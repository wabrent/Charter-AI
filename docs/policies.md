# Agent spending policies

Give an AI agent a wallet it can spend from, with limits it cannot break and everyone can read.

Status: **design and contracts with tests. Not audited, not deployed.** No token is involved.

## Why

An agent that pays for APIs, data or other agents needs a key that can move money. Today that key is usually an ordinary wallet: if the agent is compromised, misled by a prompt or simply buggy, it can spend everything in it. The people it pays have no way to know how much it is allowed to spend, or whether anyone is watching.

A policy wallet splits the two roles. The **owner** funds the wallet and sets the rules. The **agent** holds a separate key that can only pay within those rules. The rules live in the contract, so they hold even if the agent's key leaks, and they are public, so a counterparty can check them before it does business with the agent.

## Roles

| Role | Can | Cannot |
|---|---|---|
| Owner | Set limits and the allowlist, pause, rotate the agent key, withdraw, make any call | — (it is the owner's wallet) |
| Agent | Pay in ETH or an ERC-20 within the limits | Change rules, withdraw beyond limits, call other contracts, approve spenders |
| Anyone | Read the policy and the day's spending | Anything else |

## The rules

v1 has three rules. They apply to the agent only; the owner is never limited.

| Rule | What it does |
|---|---|
| **Per-payment limit** | The most one payment can move, per asset |
| **Daily limit** | The most that can move in one UTC day, per asset |
| **Allowlist** | When on, the agent can only pay listed addresses |

Assets are ETH (written as `address(0)`) and ERC-20 tokens such as USDG. **An asset with no limits set cannot be spent by the agent at all.** Everything is denied until the owner allows it.

The daily window is the UTC day, counted from `block.timestamp / 1 days`. It resets at 00:00 UTC, not 24 hours after the first payment.

## What the agent can and cannot do

The agent has two functions: `payETH(to, amount)` and `pay(token, to, amount)`. The wallet makes the transfer itself, measures it, and checks it against the rules before sending.

The agent cannot make arbitrary contract calls in v1. A general `execute` would let it call `approve` on a token and hand a spender unlimited access, which no spending limit could see. Calls to specific contracts (a swap, an x402 facilitator) come in v2, each with its own rule.

## What the owner can do

- `setLimits(asset, perPayment, perDay)`. Setting both to zero blocks the asset again.
- `setAllowed(address, bool)` and `setAllowlistEnabled(bool)`.
- `setAgent(address)` to rotate a leaked or retired agent key.
- `setPaused(bool)`: a kill switch that stops every agent payment at once.
- `withdraw(asset, to, amount)` and `execute(target, value, data)`: the owner can always take its money out or use the wallet directly.

Every change emits an event, so the history of the policy is on chain.

## Linking a wallet to an agent

`AgentAccountFactory.create(agentId, agentKey)` deploys a policy wallet for an ERC-8004 agent. Only the wallet that owns the agent in the Identity Registry can create it, and the factory records it as `accountOf(agentId)`. Charter can then show the wallet and its policy on the agent's profile, and nobody can attach a wallet to an agent they do not own.

## What a counterparty sees

On the agent's profile:

```
Spending policy · wallet 0x…
USDG   up to 50 per payment · 500 per day · 120 spent today
ETH    not allowed
Allowlist: on (12 addresses)        Status: active
```

That tells a merchant the agent cannot overspend, and tells anyone watching how much it has spent today.

## Trust assumptions in v1

- **The owner is trusted completely.** It can change any rule at any time, including raising limits. The policy protects the owner from its own agent, not counterparties from the owner.
- **Limits are per asset, not in dollars.** 500 USDG and 0.2 ETH are separate limits; v1 has no price oracle.
- **Standard ERC-20 only.** Tokens that take a fee on transfer or rebase are not supported.
- **The agent key must still be kept safe.** A leaked key can spend up to the daily limit before the owner pauses or rotates it. The limit is the worst case, which is the point.

## Roadmap

1. **Stage 1, this design.** Payments with per-payment and daily limits, an allowlist, pause, key rotation and the factory. Contracts and tests in `contracts/`.
2. **Stage 2, calls with rules.** Specific contract calls for the agent (swaps, x402 facilitators), each with a target and function allowlist, plus EIP-1271 signatures so the wallet can sign x402 payment authorizations.
3. **Stage 3, Verified counterparties.** A rule that only lets the agent pay agents with a Charter Verified badge (see `docs/validators.md`).
4. **Delayed loosening.** Tightening a rule takes effect at once, loosening after a delay, so a stolen owner session cannot raise limits and drain in one block.

## Contracts

| Contract | Role |
|---|---|
| `AgentAccount.sol` | The policy wallet: owner, agent key, limits, allowlist, pause, payments |
| `AgentAccountFactory.sol` | Deploys a wallet for an ERC-8004 agent, only for that agent's owner |

Run the tests: `cd contracts && npm install && npx hardhat test`. `scripts/deploy.js` deploys the factory next to `AgentValidation` (see `docs/validators.md` for the `.env` setup).

## On the site

`app.html#policies-<agentId>` shows an agent's policy wallet: owner, agent key, status, allowlist and a table of limits and today's spending per asset. Assets are found from the wallet's `LimitsSet` events, so a token appears as soon as the owner limits it. When the connected wallet is the owner, the page also offers the controls: create the wallet, set limits, edit the allowlist, pause, rotate the agent key. A token the wallet has never limited is asked for its `decimals()` first, so "50" always means 50 tokens.

Agent profiles show the same table under **Spending policy** with a link to the policy page.

It is off until `POLICY.factory` is set in `app.html`, and it must point at a deployment on the same chain as the registry. For local testing only, `app.html?factory=<address>&vrpc=http://127.0.0.1:8545#policies-8843` points the page at a local deployment; the override is ignored on any other host.
