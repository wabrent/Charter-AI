// Deploys AgentValidation and AgentAccountFactory and writes deployments/<chainId>.json.
//
// Every address and parameter comes from the environment (see .env.example). On a test network you can
// leave TOKEN and IDENTITY empty: the script then deploys MockToken and MockIdentity and says so.
// On chain 4663 (Robinhood Chain mainnet) it refuses to deploy mocks.
//
//   npx hardhat run scripts/deploy.js --network rhtest
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const MAINNET_CHAIN_ID = 4663n;
const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const units = (k, d) => ethers.parseEther(env(k, d));
const secs = (k, d) => Number(env(k, d));

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const isMainnet = chainId === MAINNET_CHAIN_ID;
  console.log(`network ${network.name} (chain ${chainId}), deployer ${deployer.address}`);

  let token = env("TOKEN", "");
  let identity = env("IDENTITY", "");
  const mocks = {};
  if (isMainnet && (!token || !identity)) throw new Error("On mainnet TOKEN and IDENTITY must be set. Mocks are for test networks only.");
  if (!token) {
    const t = await ethers.deployContract("MockToken");
    await t.waitForDeployment();
    token = t.target;
    mocks.token = token;
    console.log(`deployed MockToken ${token}`);
  }
  if (!identity) {
    const i = await ethers.deployContract("MockIdentity");
    await i.waitForDeployment();
    identity = i.target;
    mocks.identity = identity;
    console.log(`deployed MockIdentity ${identity}`);
  }

  const arbiter = env("ARBITER", deployer.address);
  const treasury = env("TREASURY", deployer.address);
  if (isMainnet && (arbiter === deployer.address || treasury === deployer.address)) {
    throw new Error("On mainnet ARBITER and TREASURY must be set explicitly (a Safe), not the deployer key.");
  }

  const params = {
    minBond: units("MIN_BOND", "100000"),
    missPenalty: units("MISS_PENALTY", "5000"),
    fraudPenalty: units("FRAUD_PENALTY", "50000"),
    challengeBond: units("CHALLENGE_BOND", "10000"),
    acceptWindow: secs("ACCEPT_WINDOW", String(24 * 3600)),
    responseWindow: secs("RESPONSE_WINDOW", String(48 * 3600)),
    challengeWindow: secs("CHALLENGE_WINDOW", String(72 * 3600)),
    unbondDelay: secs("UNBOND_DELAY", String(7 * 24 * 3600)),
    validity: secs("VALIDITY", String(30 * 24 * 3600)),
  };

  const av = await ethers.deployContract("AgentValidation", [token, identity, arbiter, treasury, params]);
  await av.waitForDeployment();
  const receipt = await av.deploymentTransaction().wait();
  console.log(`deployed AgentValidation ${av.target} at block ${receipt.blockNumber}`);

  const factory = await ethers.deployContract("AgentAccountFactory", [identity]);
  await factory.waitForDeployment();
  console.log(`deployed AgentAccountFactory ${factory.target}`);

  const out = {
    chainId: Number(chainId),
    network: network.name,
    deployedAt: new Date().toISOString(),
    block: receipt.blockNumber,
    deployer: deployer.address,
    AgentValidation: av.target,
    AgentAccountFactory: factory.target,
    token,
    identity,
    arbiter,
    treasury,
    mocks,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.toString()])),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
