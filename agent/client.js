// Client for an agent's Charter spending-policy wallet (contracts/contracts/AgentAccount.sol).
// The agent signs with its own key; the wallet enforces the owner's limits on chain.
const { ethers } = require("ethers");

const DEFAULTS = {
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  factory: "", // set CHARTER_FACTORY until the mainnet address is filled in here
};

const FACTORY_ABI = ["function currentAccount(uint256 agentId) view returns (address)"];
const ACCOUNT_ABI = [
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function agentId() view returns (uint256)",
  "function paused() view returns (bool)",
  "function allowlistEnabled() view returns (bool)",
  "function allowed(address) view returns (bool)",
  "function limits(address) view returns (uint128 perPayment, uint128 perDay)",
  "function spentToday(address) view returns (uint256)",
  "function remainingToday(address) view returns (uint256)",
  "function payETH(address to, uint256 amount)",
  "function pay(address token, address to, uint256 amount)",
  "event LimitsSet(address indexed asset, uint128 perPayment, uint128 perDay)",
  "error NotAgent()",
  "error IsPaused()",
  "error ZeroAddress()",
  "error NotAllowed()",
  "error OverPaymentLimit()",
  "error OverDailyLimit()",
  "error TransferFailed()",
];
const ERC20_ABI = ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"];
const ETH = ethers.ZeroAddress;

const WHY = {
  NotAgent: "this key is not the wallet's agent key",
  IsPaused: "the owner has paused this agent",
  ZeroAddress: "the recipient is the zero address",
  NotAllowed: "the recipient is not on the owner's allowlist",
  OverPaymentLimit: "the amount is over the per-payment limit (or the asset is not allowed at all)",
  OverDailyLimit: "the payment would pass today's limit (resets at 00:00 UTC)",
  TransferFailed: "the recipient refused the ETH transfer",
};

function config(env = process.env) {
  return {
    rpc: env.CHARTER_RPC || DEFAULTS.rpc,
    factory: env.CHARTER_FACTORY || DEFAULTS.factory,
    agentId: env.CHARTER_AGENT_ID,
    account: env.CHARTER_ACCOUNT,
    key: env.AGENT_KEY,
  };
}

async function resolveAccount(provider, cfg) {
  if (cfg.account) return ethers.getAddress(cfg.account);
  if (!cfg.factory) throw new Error("Set CHARTER_ACCOUNT (the policy wallet) or CHARTER_FACTORY with CHARTER_AGENT_ID.");
  if (cfg.agentId === undefined) throw new Error("Set CHARTER_AGENT_ID.");
  const acc = await new ethers.Contract(cfg.factory, FACTORY_ABI, provider).currentAccount(BigInt(cfg.agentId));
  if (acc === ETH) throw new Error(`Agent ${cfg.agentId} has no policy wallet.`);
  return acc;
}

async function assetInfo(provider, asset) {
  if (asset === ETH) return { asset, symbol: "ETH", decimals: 18 };
  const t = new ethers.Contract(asset, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([t.symbol().catch(() => "TOKEN"), t.decimals()]);
  return { asset: ethers.getAddress(asset), symbol, decimals: Number(decimals) };
}

/** Reads the whole policy: owner, agent key, status, and every asset the owner has limited. */
async function readPolicy(cfg = config()) {
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const address = await resolveAccount(provider, cfg);
  const acc = new ethers.Contract(address, ACCOUNT_ABI, provider);
  const [owner, agent, agentId, paused, allowlist] = await Promise.all([acc.owner(), acc.agent(), acc.agentId(), acc.paused(), acc.allowlistEnabled()]);
  const logs = await acc.queryFilter(acc.filters.LimitsSet(), 0, "latest").catch(() => []);
  const assets = [ETH, ...new Set(logs.map((l) => ethers.getAddress(l.args.asset)))].filter((a, i, all) => all.indexOf(a) === i);
  const rows = await Promise.all(
    assets.map(async (a) => {
      const info = await assetInfo(provider, a);
      const [lim, spent, left] = await Promise.all([acc.limits(a), acc.spentToday(a), acc.remainingToday(a)]);
      const f = (v) => ethers.formatUnits(v, info.decimals);
      return { ...info, perPayment: f(lim.perPayment), perDay: f(lim.perDay), spentToday: f(spent), remainingToday: f(left), blocked: lim.perDay === 0n };
    })
  );
  return { wallet: address, agentId: agentId.toString(), owner, agentKey: agent, paused, allowlist, assets: rows };
}

function reason(err, iface) {
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { name: parsed.name, why: WHY[parsed.name] || parsed.name };
    } catch (_) {}
  }
  const m = /(NotAgent|IsPaused|ZeroAddress|NotAllowed|OverPaymentLimit|OverDailyLimit|TransferFailed)/.exec(String(err?.message || ""));
  if (m) return { name: m[1], why: WHY[m[1]] };
  return null;
}

/**
 * Pays from the policy wallet with the agent key. Simulates first, so a payment the policy forbids
 * comes back with a reason and costs no gas. `token` is "ETH" or an ERC-20 address; `amount` is in token units ("30", "0.05").
 */
async function pay({ token, to, amount }, cfg = config()) {
  if (!cfg.key) throw new Error("Set AGENT_KEY to the agent's private key.");
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const signer = new ethers.Wallet(cfg.key, provider);
  const address = await resolveAccount(provider, cfg);
  const acc = new ethers.Contract(address, ACCOUNT_ABI, signer);
  const asset = !token || String(token).toUpperCase() === "ETH" ? ETH : ethers.getAddress(token);
  const info = await assetInfo(provider, asset);
  const value = ethers.parseUnits(String(amount), info.decimals);
  const recipient = ethers.getAddress(to);
  const lim = await acc.limits(asset);
  if (lim.perDay === 0n) return { ok: false, error: "AssetBlocked", why: `the owner has not allowed ${info.symbol} for this agent`, wallet: address };
  const fn = asset === ETH ? acc.payETH : acc.pay;
  const args = asset === ETH ? [recipient, value] : [asset, recipient, value];
  try {
    await fn.staticCall(...args);
  } catch (e) {
    const r = reason(e, acc.interface);
    return { ok: false, error: r ? r.name : "Reverted", why: r ? r.why : String(e.shortMessage || e.message), wallet: address };
  }
  const tx = await fn(...args);
  const rc = await tx.wait();
  return { ok: rc.status === 1, tx: rc.hash, block: rc.blockNumber, paid: `${amount} ${info.symbol}`, to: recipient, wallet: address };
}

module.exports = { config, readPolicy, pay, WHY, ETH };
