#!/usr/bin/env node
// MCP server: gives an AI agent two tools for its Charter policy wallet.
//   get_spending_policy  read limits, today's spending and status
//   pay                  pay ETH or a token; the wallet rejects anything the owner's policy forbids
// Configure with env: AGENT_KEY, CHARTER_FACTORY + CHARTER_AGENT_ID (or CHARTER_ACCOUNT), CHARTER_RPC.
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { config, readPolicy, pay } = require("./client");

const server = new McpServer({ name: "charter-agent-wallet", version: "0.1.0" });
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });

server.tool(
  "get_spending_policy",
  "Read this agent's spending policy: per-payment and daily limits per asset, what was spent today, the allowlist and whether the owner has paused it.",
  {},
  async () => text(await readPolicy(config()))
);

server.tool(
  "pay",
  "Pay from this agent's policy wallet. The payment is checked against the owner's limits first; if the policy forbids it, nothing is sent and the reason is returned.",
  {
    to: z.string().describe("Recipient address, 0x…"),
    amount: z.string().describe('Amount in token units, for example "30" or "0.01"'),
    token: z.string().default("ETH").describe('"ETH" or an ERC-20 token address'),
  },
  async ({ to, amount, token }) => text(await pay({ to, amount, token }, config()))
);

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
