// Deploys AgentAccountFactory against an existing ERC-8004 Identity Registry and writes
// deployments/<chainId>-policies.json. On chain 4663 it only accepts the official registry.
//
//   npx hardhat run scripts/deploy-policies.js --network rhmain
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const OFFICIAL_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const identity = process.env.IDENTITY || "";
  if (!ethers.isAddress(identity)) throw new Error("Set IDENTITY to the ERC-8004 Identity Registry address.");
  if (chainId === 4663n && ethers.getAddress(identity) !== OFFICIAL_REGISTRY) throw new Error("On mainnet IDENTITY must be the official registry " + OFFICIAL_REGISTRY);
  if ((await ethers.provider.getCode(identity)) === "0x") throw new Error("No contract at IDENTITY on this chain.");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`network ${network.name} (chain ${chainId}), deployer ${deployer.address}, balance ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error("The deployer has no ETH for gas.");

  const factory = await ethers.deployContract("AgentAccountFactory", [identity]);
  const receipt = await factory.deploymentTransaction().wait();
  console.log(`deployed AgentAccountFactory ${factory.target} in tx ${receipt.hash} (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);

  const out = {
    chainId: Number(chainId),
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    identity: ethers.getAddress(identity),
    AgentAccountFactory: factory.target,
    tx: receipt.hash,
    block: receipt.blockNumber,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}-policies.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
