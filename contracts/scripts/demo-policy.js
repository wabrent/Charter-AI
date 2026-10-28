// Local demo setup for the policy video: an agent with a policy wallet, a mock token limit of
// 50 per payment / 120 per day, the allowlist on with one merchant, and the wallet funded.
// Runs on a local chain only (31337).
//
//   npx hardhat node                                         (terminal 1)
//   npx hardhat run scripts/deploy.js --network localhost
//   AGENT_ID=8843 npx hardhat run scripts/demo-policy.js --network localhost
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) throw new Error("demo-policy mints mock tokens; run it on a local chain only.");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${chainId}.json`), "utf8"));
  if (!dep.mocks.token || !dep.mocks.identity) throw new Error("demo-policy needs the mock token and identity from deploy.js.");

  const agentId = BigInt(process.env.AGENT_ID || "8843");
  const [, owner, agentKey, merchant] = await ethers.getSigners();
  const identity = await ethers.getContractAt("MockIdentity", dep.identity);
  const token = await ethers.getContractAt("MockToken", dep.token);
  const factory = await ethers.getContractAt("AgentAccountFactory", dep.AgentAccountFactory);

  await (await identity.mint(owner.address, agentId)).wait();
  await (await factory.connect(owner).create(agentId, agentKey.address)).wait();
  const account = await ethers.getContractAt("AgentAccount", await factory.accountOf(agentId));
  await (await account.connect(owner).setLimits(token.target, ethers.parseEther("50"), ethers.parseEther("120"))).wait();
  await (await account.connect(owner).setAllowed(merchant.address, true)).wait();
  await (await account.connect(owner).setAllowlistEnabled(true)).wait();
  await (await token.mint(account.target, ethers.parseEther("1000"))).wait();

  const out = { agentId: agentId.toString(), factory: dep.AgentAccountFactory, account: account.target, token: token.target, owner: owner.address, agentKey: agentKey.address, merchant: merchant.address };
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
