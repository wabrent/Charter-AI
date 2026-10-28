const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const e = (n) => ethers.parseEther(String(n));
const ETH = ethers.ZeroAddress;
const DAY = 24 * 3600;
const AGENT_ID = 7n;

async function deploy() {
  const [owner, agent, merchant, other, stranger, newAgent] = await ethers.getSigners();
  const identity = await ethers.deployContract("MockIdentity");
  const token = await ethers.deployContract("MockToken");
  const factory = await ethers.deployContract("AgentAccountFactory", [identity.target]);
  await identity.mint(owner.address, AGENT_ID);
  await factory.connect(owner).create(AGENT_ID, agent.address);
  const account = await ethers.getContractAt("AgentAccount", await factory.accountOf(AGENT_ID));
  await owner.sendTransaction({ to: account.target, value: e(10) });
  await token.mint(account.target, e(10_000));
  return { owner, agent, merchant, other, stranger, newAgent, identity, token, factory, account };
}

async function limited() {
  const f = await deploy();
  await f.account.connect(f.owner).setLimits(f.token.target, e(50), e(120));
  await f.account.connect(f.owner).setLimits(ETH, e(0.1), e(0.25));
  return f;
}

async function startOfNextDay() {
  const now = await time.latest();
  return (Math.floor(now / DAY) + 1) * DAY;
}

describe("AgentAccount", function () {
  describe("factory", function () {
    it("creates a wallet owned by the agent's owner and records it", async function () {
      const { owner, agent, account, factory } = await loadFixture(deploy);
      expect(await account.owner()).to.equal(owner.address);
      expect(await account.agent()).to.equal(agent.address);
      expect(await account.agentId()).to.equal(AGENT_ID);
      expect(await factory.currentAccount(AGENT_ID)).to.equal(account.target);
    });

    it("refuses anyone but the agent's owner", async function () {
      const { factory, stranger } = await loadFixture(deploy);
      await expect(factory.connect(stranger).create(AGENT_ID, stranger.address)).to.be.revertedWithCustomError(factory, "NotAgentOwner");
    });

    it("stops pointing at the wallet once the agent changes hands", async function () {
      const { factory, identity, owner, other } = await loadFixture(deploy);
      await identity.connect(owner).transferFrom(owner.address, other.address, AGENT_ID);
      expect(await factory.currentAccount(AGENT_ID)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("default deny", function () {
    it("blocks an asset with no limits set", async function () {
      const { account, agent, merchant, token } = await loadFixture(deploy);
      await expect(account.connect(agent).pay(token.target, merchant.address, 1n)).to.be.revertedWithCustomError(account, "OverPaymentLimit");
      await expect(account.connect(agent).payETH(merchant.address, 1n)).to.be.revertedWithCustomError(account, "OverPaymentLimit");
    });

    it("only the agent can pay and only the owner can set rules", async function () {
      const { account, stranger, owner, merchant, token } = await loadFixture(limited);
      await expect(account.connect(stranger).pay(token.target, merchant.address, 1n)).to.be.revertedWithCustomError(account, "NotAgent");
      await expect(account.connect(owner).pay(token.target, merchant.address, 1n)).to.be.revertedWithCustomError(account, "NotAgent");
      await expect(account.connect(stranger).setLimits(token.target, e(1), e(1))).to.be.revertedWithCustomError(account, "NotOwner");
      await expect(account.connect(stranger).setPaused(true)).to.be.revertedWithCustomError(account, "NotOwner");
    });

    it("rejects a per-payment limit above the daily limit", async function () {
      const { account, owner, token } = await loadFixture(deploy);
      await expect(account.connect(owner).setLimits(token.target, e(2), e(1))).to.be.revertedWithCustomError(account, "BadLimits");
    });
  });

  describe("limits", function () {
    it("pays within the limits and tracks the day's spending", async function () {
      const { account, agent, merchant, token } = await loadFixture(limited);
      await expect(account.connect(agent).pay(token.target, merchant.address, e(50)))
        .to.emit(account, "Paid")
        .withArgs(token.target, merchant.address, e(50), e(50));
      expect(await token.balanceOf(merchant.address)).to.equal(e(50));
      expect(await account.spentToday(token.target)).to.equal(e(50));
      expect(await account.remainingToday(token.target)).to.equal(e(70));
    });

    it("rejects a payment over the per-payment limit", async function () {
      const { account, agent, merchant, token } = await loadFixture(limited);
      await expect(account.connect(agent).pay(token.target, merchant.address, e(50) + 1n)).to.be.revertedWithCustomError(account, "OverPaymentLimit");
    });

    it("rejects a payment that would pass the daily limit", async function () {
      const { account, agent, merchant, token } = await loadFixture(limited);
      await account.connect(agent).pay(token.target, merchant.address, e(50));
      await account.connect(agent).pay(token.target, merchant.address, e(50));
      await expect(account.connect(agent).pay(token.target, merchant.address, e(21))).to.be.revertedWithCustomError(account, "OverDailyLimit");
      await account.connect(agent).pay(token.target, merchant.address, e(20)); // exactly at the cap
      expect(await account.remainingToday(token.target)).to.equal(0n);
    });

    it("resets at 00:00 UTC", async function () {
      const { account, agent, merchant, token } = await loadFixture(limited);
      await account.connect(agent).pay(token.target, merchant.address, e(50));
      await account.connect(agent).pay(token.target, merchant.address, e(50));
      await account.connect(agent).pay(token.target, merchant.address, e(20));
      await time.increaseTo(await startOfNextDay());
      expect(await account.spentToday(token.target)).to.equal(0n);
      await account.connect(agent).pay(token.target, merchant.address, e(50));
    });

    it("keeps ETH and tokens on separate limits", async function () {
      const { account, agent, merchant, token } = await loadFixture(limited);
      await account.connect(agent).pay(token.target, merchant.address, e(50));
      await expect(account.connect(agent).payETH(merchant.address, e(0.1))).to.changeEtherBalance(merchant, e(0.1));
      await account.connect(agent).payETH(merchant.address, e(0.1));
      await expect(account.connect(agent).payETH(merchant.address, e(0.1))).to.be.revertedWithCustomError(account, "OverDailyLimit");
      expect(await account.spentToday(ETH)).to.equal(e(0.2));
    });

    it("blocks an asset again when its limits are set to zero", async function () {
      const { account, owner, agent, merchant, token } = await loadFixture(limited);
      await account.connect(owner).setLimits(token.target, 0, 0);
      await expect(account.connect(agent).pay(token.target, merchant.address, 1n)).to.be.revertedWithCustomError(account, "OverPaymentLimit");
    });
  });

  describe("allowlist", function () {
    it("only pays listed addresses when enabled", async function () {
      const { account, owner, agent, merchant, other, token } = await loadFixture(limited);
      await account.connect(owner).setAllowed(merchant.address, true);
      await account.connect(owner).setAllowlistEnabled(true);
      await account.connect(agent).pay(token.target, merchant.address, e(1));
      await expect(account.connect(agent).pay(token.target, other.address, e(1))).to.be.revertedWithCustomError(account, "NotAllowed");
      expect(await account.allowedCount()).to.equal(1n);
      await account.connect(owner).setAllowed(merchant.address, false);
      expect(await account.allowedCount()).to.equal(0n);
      await expect(account.connect(agent).pay(token.target, merchant.address, e(1))).to.be.revertedWithCustomError(account, "NotAllowed");
    });

    it("does not double count repeated adds", async function () {
      const { account, owner, merchant } = await loadFixture(limited);
      await account.connect(owner).setAllowed(merchant.address, true);
      await account.connect(owner).setAllowed(merchant.address, true);
      expect(await account.allowedCount()).to.equal(1n);
    });
  });

  describe("owner controls", function () {
    it("pause stops every agent payment", async function () {
      const { account, owner, agent, merchant, token } = await loadFixture(limited);
      await account.connect(owner).setPaused(true);
      await expect(account.connect(agent).pay(token.target, merchant.address, e(1))).to.be.revertedWithCustomError(account, "IsPaused");
      await expect(account.connect(agent).payETH(merchant.address, e(0.01))).to.be.revertedWithCustomError(account, "IsPaused");
      await account.connect(owner).setPaused(false);
      await account.connect(agent).pay(token.target, merchant.address, e(1));
    });

    it("rotating the agent key locks out the old one", async function () {
      const { account, owner, agent, newAgent, merchant, token } = await loadFixture(limited);
      await account.connect(owner).setAgent(newAgent.address);
      await expect(account.connect(agent).pay(token.target, merchant.address, e(1))).to.be.revertedWithCustomError(account, "NotAgent");
      await account.connect(newAgent).pay(token.target, merchant.address, e(1));
    });

    it("the owner can withdraw and call anything, unlimited", async function () {
      const { account, owner, other, token } = await loadFixture(limited);
      await expect(account.connect(owner).withdraw(token.target, other.address, e(5_000))).to.changeTokenBalance(token, other, e(5_000));
      await expect(account.connect(owner).withdraw(ETH, other.address, e(5))).to.changeEtherBalance(other, e(5));
      const data = token.interface.encodeFunctionData("transfer", [other.address, e(1)]);
      await expect(account.connect(owner).execute(token.target, 0, data)).to.changeTokenBalance(token, other, e(1));
    });

    it("the agent cannot withdraw or call contracts", async function () {
      const { account, agent, other, token } = await loadFixture(limited);
      await expect(account.connect(agent).withdraw(token.target, other.address, 1n)).to.be.revertedWithCustomError(account, "NotOwner");
      const data = token.interface.encodeFunctionData("approve", [other.address, ethers.MaxUint256]);
      await expect(account.connect(agent).execute(token.target, 0, data)).to.be.revertedWithCustomError(account, "NotOwner");
    });
  });

  describe("safety", function () {
    it("an agent cannot re-enter a payment from inside the ETH it receives", async function () {
      const { account, owner } = await loadFixture(limited);
      const bad = await ethers.deployContract("ReentrantAgent");
      await bad.setAccount(account.target);
      await account.connect(owner).setAgent(bad.target);
      await expect(bad.start(e(0.05))).to.be.revertedWithCustomError(account, "TransferFailed");
      expect(await account.spentToday(ETH)).to.equal(0n);
    });

    it("rejects payments to the zero address and zero amounts", async function () {
      const { account, agent, token } = await loadFixture(limited);
      await expect(account.connect(agent).pay(token.target, ethers.ZeroAddress, e(1))).to.be.revertedWithCustomError(account, "ZeroAddress");
      await expect(account.connect(agent).pay(token.target, agent.address, 0n)).to.be.revertedWithCustomError(account, "OverPaymentLimit");
    });
  });
});
