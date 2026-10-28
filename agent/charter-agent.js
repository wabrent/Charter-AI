#!/usr/bin/env node
// CLI for an agent's Charter policy wallet.
//
//   CHARTER_FACTORY=0x… CHARTER_AGENT_ID=8843 node charter-agent.js policy
//   AGENT_KEY=0x… CHARTER_FACTORY=0x… CHARTER_AGENT_ID=8843 node charter-agent.js pay --token ETH --to 0x… --amount 0.01
const { config, readPolicy, pay } = require("./client");

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1], i++;
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const cfg = config();
  if (f.agent) cfg.agentId = f.agent;
  if (f.account) cfg.account = f.account;
  if (cmd === "policy") {
    console.log(JSON.stringify(await readPolicy(cfg), null, 2));
  } else if (cmd === "pay") {
    if (!f.to || !f.amount) throw new Error("pay needs --to <address> --amount <n> [--token ETH|0x…]");
    const r = await pay({ token: f.token || "ETH", to: f.to, amount: f.amount }, cfg);
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 2;
  } else {
    console.log("usage: charter-agent policy | charter-agent pay --to <address> --amount <n> [--token ETH|0x…]\nenv: AGENT_KEY, CHARTER_FACTORY + CHARTER_AGENT_ID (or CHARTER_ACCOUNT), CHARTER_RPC");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
