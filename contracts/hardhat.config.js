require("@nomicfoundation/hardhat-toolbox");

// Networks come from the environment so no RPC URL or key lives in the repo. See .env.example.
// Load a local .env if present, without adding a dependency.
const fs = require("fs");
const envFile = require("path").join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const key = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];
const networks = {};
if (process.env.RH_TESTNET_RPC) {
  networks.rhtest = {
    url: process.env.RH_TESTNET_RPC,
    accounts: key,
    ...(process.env.RH_TESTNET_CHAIN_ID ? { chainId: Number(process.env.RH_TESTNET_CHAIN_ID) } : {}),
  };
}
if (process.env.RH_MAINNET_RPC) {
  networks.rhmain = { url: process.env.RH_MAINNET_RPC, accounts: key, chainId: 4663 };
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
  // Source verification on Robinhood Chain's Blockscout (no API key needed; any non-empty value works).
  etherscan: {
    apiKey: { rhmain: "blockscout", rhtest: "blockscout" },
    customChains: [
      { network: "rhmain", chainId: 4663, urls: { apiURL: "https://robinhoodchain.blockscout.com/api", browserURL: "https://robinhoodchain.blockscout.com" } },
      { network: "rhtest", chainId: 46630, urls: { apiURL: "https://explorer.testnet.chain.robinhood.com/api", browserURL: "https://explorer.testnet.chain.robinhood.com" } },
    ],
  },
  sourcify: { enabled: false },
};
