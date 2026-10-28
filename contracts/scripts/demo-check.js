// Local demo: runs one full check (bond, request, accept, respond, finalize) so the site can show a badge.
// Uses mocks and fast-forwards time, so it only runs on a local chain (31337).
//
//   npx hardhat node                                   (terminal 1)
//   npx hardhat run scripts/deploy.js --network localhost
//   AGENT_ID=8843 npx hardhat run scripts/demo-check.js --network localhost
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) throw new Error("demo-check fast-forwards time and mints mock tokens; run it on a local chain only.");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${chainId}.json`), "utf8"));
  if (!dep.mocks.token || !dep.mocks.identity) throw new Error("demo-check needs the mock token and identity from deploy.js.");

  const agentId = BigInt(process.env.AGENT_ID || "8843");
  const claim = ethers.encodeBytes32String(process.env.CLAIM || "ENDPOINT_LIVE");
  const [, owner, validator] = await ethers.getSigners();
  const av = await ethers.getContractAt("AgentValidation", dep.AgentValidation);
  const token = await ethers.getContractAt("MockToken", dep.token);
  const identity = await ethers.getContractAt("MockIdentity", dep.identity);

  const minBond = await av.minBond();
  const fee = ethers.parseEther("1000");
  await (await identity.mint(owner.address, agentId)).wait();
  for (const s of [owner, validator]) {
    await (await token.mint(s.address, minBond * 2n)).wait();
    await (await token.connect(s).approve(av.target, ethers.MaxUint256)).wait();
  }
  await (await av.connect(validator).bond(minBond)).wait();
  const id = await av.nextCheckId();
  await (await av.connect(owner).request(agentId, claim, validator.address, fee)).wait();
  await (await av.connect(validator).accept(id)).wait();
  await (await av.connect(validator).respond(id, true, ethers.id("demo evidence"), "ipfs://demo-evidence")).wait();
  await network.provider.send("evm_increaseTime", [Number(await av.challengeWindow()) + 1]);
  await network.provider.send("evm_mine");
  await (await av.finalize(id)).wait();

  console.log(`agent ${agentId} ${ethers.decodeBytes32String(claim)}: isVerified = ${await av.isVerified(agentId, claim)}`);
  console.log(`check ${id}, validator ${validator.address}, verified until ${new Date(Number(await av.verifiedUntil(agentId, claim)) * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
