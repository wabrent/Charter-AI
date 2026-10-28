# Bonded validators

Charter shows who an agent is. Validators check whether what it says about itself is true, and put money behind the answer.

Status: **design and contracts with tests. Not audited, not deployed.** The bond token is not launched; its name comes with the rebrand.

## Why

An ERC-8004 profile is a self-description. Anyone can register an agent that claims an MCP endpoint, a domain or a track record, and nothing on chain says whether any of it is true. A "verified" badge that the site hands out by itself is just another claim.

Bonded validators replace that claim with a bet. A validator stakes tokens, checks one specific fact about one agent, and signs the result. If the validator misses the deadline, the contract takes part of the stake automatically. If the validator signs something false and is caught, it loses more.

## Roles

| Role | Does | Risks |
|---|---|---|
| Agent owner | Asks for a check of its own agent and pays the fee | The fee, if the check fails |
| Validator | Bonds tokens, accepts checks, signs a pass or fail with evidence | Its bond, on a missed deadline or a false answer |
| Challenger | Disputes a signed answer within the challenge window | Its challenge bond, if the dispute is rejected |
| Arbiter | Decides disputes (v1 only, see trust assumptions) | Nothing on chain; it is trusted |

Only the wallet that owns the agent in the ERC-8004 Identity Registry (`ownerOf(agentId)`) can request a check of that agent.

## What gets checked

Each check names one **claim type**, a `bytes32`. v1 starts with claims a person or a script can verify from the outside:

| Claim type | Passes when |
|---|---|
| `ENDPOINT_LIVE` | Every web, MCP or A2A endpoint in the profile answers |
| `MCP_TOOLS_MATCH` | The MCP endpoint lists the tools the description promises |
| `DOMAIN_CONTROL` | The agent's domain serves a file naming the agent ID and owner |
| `X402_ACCEPTS` | An x402 endpoint returns a valid 402 payment request |

The contract does not interpret claim types. They are labels the site and validators agree on, and new ones need no contract change.

## Lifecycle of a check

```
request ──> accept ──> respond ──> (challenge window) ──> finalize
   │           │           │                 │
   │           │           │                 └─ challenge ──> arbiter resolves
   │           │           └─ deadline missed ──> slashMissed
   │           └─ not accepted in time ──> cancel (fee refunded)
```

1. **Request.** The owner picks a validator, a claim type and a fee, and pays the fee into the contract.
2. **Accept.** The validator accepts within the accept window. Accepting locks part of its bond (the fraud penalty), so it cannot unbond while the check is open.
3. **Respond.** The validator posts pass or fail, an evidence URI and the hash of that evidence before the response deadline.
4. **Challenge window.** Anyone can dispute the answer by posting a challenge bond.
5. **Finalize.** If nobody challenged, anyone can finalize. The fee is split, the locked bond is released, and a passing answer stays valid for the validity period.

If the validator accepted but never responded, **anyone** can call `slashMissed` after the deadline. That failure is fully contract-checkable: the deadline is on chain and so is the missing response.

## Money flows

All amounts are in the bond token. Parameters are fixed when the contract is deployed and cannot be changed afterwards. Proposed values:

| Parameter | Proposed | What it does |
|---|---|---|
| `minBond` | 100,000 | Minimum bond to accept checks |
| `missPenalty` | 5,000 | Taken for a missed response deadline |
| `fraudPenalty` | 50,000 | Locked on accept, taken if a challenge is upheld |
| `challengeBond` | 10,000 | Posted by a challenger |
| `acceptWindow` | 24 h | Time for the validator to accept |
| `responseWindow` | 48 h | Time to respond after accepting |
| `challengeWindow` | 72 h | Time to dispute after a response |
| `unbondDelay` | 7 days | Wait between requesting and withdrawing an unbond |
| `validity` | 30 days | How long a passing answer counts as verified |

**On finalize** (no challenge): 80% of the fee to the validator, 15% burned to `0x…dEaD`, 5% to the treasury.

**On a missed deadline:** the full fee goes back to the owner. Of the miss penalty, half goes to the owner and half is burned.

**On an upheld challenge** (the validator was wrong): the full fee goes back to the owner, the challenger gets its bond back plus half of the fraud penalty, and the other half is burned.

**On a rejected challenge** (the validator was right): the check finalizes as normal, and of the challenger's bond half goes to the validator and half is burned.

Every path burns tokens. Burns come from fees and penalties, not from a tax on trading.

## What the badge means

The site shows **Verified · ENDPOINT_LIVE** on an agent when `isVerified(agentId, ENDPOINT_LIVE)` is true: a bonded validator signed a pass, nobody disputed it in time, and it is less than `validity` old. The badge links to the check, its evidence and the validator's bond.

Two rules keep the badge honest:

- **Validity runs from the answer**, not from finalize, so a dispute cannot stretch an old pass.
- **The newest answer wins.** Finalize is open to anyone at any time after the window, so checks can settle out of order. A check only updates the badge if it was answered later than the one that set it, so an old pass finalized late cannot overwrite a newer fail.

The badge does not mean the agent is safe, honest or good at its job. It means one fact was checked by someone who had money at stake.

## The token

The bond token is an ordinary ERC-20 launched separately. The contract only stores its address.

- **Validators** must hold it to bond, and the bond sets how many checks they can have open at once.
- **Agent owners** pay check fees in it.
- **Challengers** post bonds in it.
- **Fees and penalties** burn part of every flow.

Users who only browse the registry or register an agent never need the token.

## Trust assumptions in v1

- **The arbiter is a trusted address**, set at deploy and unchangeable: a Safe. It only decides disputes; it cannot move bonds, fees or anything else. Stage 2 replaces it.
- **Correctness is not provable on chain.** "This endpoint answered" happened off chain. The evidence URI and hash make the answer auditable, and the challenge window makes it contestable, but a check is only as good as the incentive to dispute a bad one.
- **Validators choose their own checks.** An owner can pick a friendly validator. The contract only stops an owner from validating its own agent from the same wallet. The badge shows which validator signed, and challenges are open to anyone.
- **Standard ERC-20 only.** The bond token must not take a fee on transfer or rebase; the accounting assumes the amount sent is the amount received.

## Roadmap

1. **Stage 1, this design.** One contract for bonds and checks, a Safe as arbiter, the badge on the site. Contracts and tests are in `contracts/`.
2. **Stage 2, a dispute panel.** Disputes go to a random panel of other bonded validators who vote with commit and reveal. The arbiter is removed.
3. **Stage 3, the ERC-8004 Validation Registry.** Finalized answers are also written to the standard's validation registry where it is deployed, so any app reading ERC-8004 sees them.

## Contracts

| Contract | Role |
|---|---|
| `AgentValidation.sol` | Bonds, checks, penalties, fee split, `isVerified` |
| `mocks/MockToken.sol`, `mocks/MockIdentity.sol` | Test stand-ins for the bond token and the Identity Registry |

Run the tests: `cd contracts && npm install && npx hardhat test`.

## Deploying

Copy `contracts/.env.example` to `contracts/.env` (git-ignored) and fill in the test network's RPC URL and chain ID from Robinhood Chain's own documentation, plus a throwaway key that holds only test ETH.

```
npx hardhat run scripts/deploy.js --network rhtest
```

With `TOKEN` and `IDENTITY` left empty, the script deploys `MockToken` and `MockIdentity` next to the contract. It writes every address and parameter to `contracts/deployments/<chainId>.json`. On chain 4663 it refuses to deploy mocks and refuses the deployer key as arbiter or treasury.

To try the whole flow without a network:

```
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
AGENT_ID=8843 npx hardhat run scripts/demo-check.js --network localhost
```

`demo-check.js` bonds a validator, requests, accepts, answers, fast-forwards past the challenge window and finalizes, so agent 8843 reads as verified.

## On the site

`app.html` reads the badge with `verifiedUntil`, `latestCheck` and `checks` for the claim `ENDPOINT_LIVE`, and shows **Verified** on registry rows and agent profiles, with the validator, the check number and the expiry on the profile.

It is off until `VALIDATION.address` is set in `app.html`, and it must point at a deployment on the same chain as the registry it shows. A test-network deployment checks mock agents, not the real ones, so the live site stays off until a mainnet deployment.

For local testing only, `http://localhost:8080/app.html?validation=<address>&vrpc=http://127.0.0.1:8545` points the app at a local deployment. The override is ignored on any other host, so a shared link cannot make the live site show a badge from some other contract.
