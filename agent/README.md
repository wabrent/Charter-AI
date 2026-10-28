# charter-agent

Lets an AI agent read and pay from its Charter spending-policy wallet. The agent signs with its own key; the wallet on Robinhood Chain enforces the limits its owner set (see `../docs/policies.md`).

Every payment is simulated first. If the policy forbids it, nothing is sent, no gas is spent, and the agent gets the reason:

| Error | Meaning |
|---|---|
| `AssetBlocked` | The owner has not allowed this asset |
| `OverPaymentLimit` | Over the per-payment limit |
| `OverDailyLimit` | Would pass today's limit (resets 00:00 UTC) |
| `NotAllowed` | Recipient is not on the allowlist |
| `IsPaused` | The owner paused the agent |
| `NotAgent` | This key is not the wallet's agent key |

> **Unaudited beta.** Keep only small amounts in a policy wallet.

## Setup

```
cd agent && npm install
```

| Variable | |
|---|---|
| `AGENT_KEY` | The agent's private key (the address the owner set as agent key). Keep it out of git. |
| `CHARTER_AGENT_ID` | The agent's ERC-8004 ID |
| `CHARTER_FACTORY` | The `AgentAccountFactory` address (see `../contracts/deployments/4663-policies.json`) |
| `CHARTER_ACCOUNT` | Optional: the policy wallet address, instead of factory + agent ID |
| `CHARTER_RPC` | Optional: defaults to `https://rpc.mainnet.chain.robinhood.com` |

The agent key pays gas, so it needs a little ETH on Robinhood Chain.

## CLI

```
node charter-agent.js policy
node charter-agent.js pay --to 0x… --amount 0.01
node charter-agent.js pay --token 0x… --to 0x… --amount 25
```

## MCP server

`mcp.js` exposes two tools over stdio:

- `get_spending_policy`: limits per asset, today's spending, allowlist and pause state
- `pay`: `{ to, amount, token? }`, where `token` is `"ETH"` (default) or an ERC-20 address

Add it to Claude Code:

```
claude mcp add charter-wallet -e AGENT_KEY=0x… -e CHARTER_AGENT_ID=8843 -e CHARTER_FACTORY=0x… -- node /path/to/agent/mcp.js
```

Or to any MCP client config:

```json
{
  "mcpServers": {
    "charter-wallet": {
      "command": "node",
      "args": ["/path/to/agent/mcp.js"],
      "env": { "AGENT_KEY": "0x…", "CHARTER_AGENT_ID": "8843", "CHARTER_FACTORY": "0x…" }
    }
  }
}
```

## Library

```js
const { readPolicy, pay } = require("./client");
const r = await pay({ token: "ETH", to: "0x…", amount: "0.01" });
if (!r.ok) console.log(r.error, r.why);
```
