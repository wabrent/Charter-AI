const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const e = (n) => ethers.parseEther(String(n));
const H = 3600;
const DAY = 24 * H;
const BURN = "0x000000000000000000000000000000000000dEaD";
const ENDPOINT_LIVE = ethers.encodeBytes32String("ENDPOINT_LIVE");
const Status = { None: 0n, Requested: 1n, Accepted: 2n, Responded: 3n, Challenged: 4n, Finalized: 5n, Cancelled: 6n, Missed: 7n, Overturned: 8n };

const PARAMS = {
  minBond: e(100_000),
  missPenalty: e(5_000),
  fraudPenalty: e(50_000),
  challengeBond: e(10_000),
  acceptWindow: 24 * H,
  responseWindow: 48 * H,
  challengeWindow: 72 * H,
  unbondDelay: 7 * DAY,
  validity: 30 * DAY,
};
const FEE = e(1_000);
const AGENT = 42n;

async function deploy() {
  const [deployer, owner, validator, challenger, arbiter, treasury, stranger, validator2] = await ethers.getSigners();
  const token = await ethers.deployContract("MockToken");
  const identity = await ethers.deployContract("MockIdentity");
  const av = await ethers.deployContract("AgentValidation", [token.target, identity.target, arbiter.address, treasury.address, PARAMS]);
  await identity.mint(owner.address, AGENT);
  for (const s of [owner, validator, challenger, stranger, validator2]) {
    await token.mint(s.address, e(1_000_000));
    await token.connect(s).approve(av.target, ethers.MaxUint256);
  }
  return { av, token, identity, deployer, owner, validator, challenger, arbiter, treasury, stranger, validator2 };
}

async function bonded() {
  const f = await deploy();
  await f.av.connect(f.validator).bond(PARAMS.minBond);
  return f;
}

async function requested() {
  const f = await bonded();
  await f.av.connect(f.owner).request(AGENT, ENDPOINT_LIVE, f.validator.address, FEE);
  return { ...f, id: 1n };
}

async function accepted() {
  const f = await requested();
  await f.av.connect(f.validator).accept(f.id);
  return f;
}

async function responded() {
  const f = await accepted();
  await f.av.connect(f.validator).respond(f.id, true, ethers.id("evidence"), "ipfs://evidence");
  return f;
}

async function challenged() {
  const f = await responded();
  await f.av.connect(f.challenger).challenge(f.id);
  return f;
}

describe("AgentValidation", function () {
  describe("deployment", function () {
    it("rejects a fraud penalty above the minimum bond", async function () {
      const [a] = await ethers.getSigners();
      const token = await ethers.deployContract("MockToken");
      const identity = await ethers.deployContract("MockIdentity");
      const bad = { ...PARAMS, fraudPenalty: PARAMS.minBond + 1n };
      const F = await ethers.getContractFactory("AgentValidation");
      await expect(F.deploy(token.target, identity.target, a.address, a.address, bad)).to.be.revertedWithCustomError(F, "BadParams");
    });

    it("rejects a miss penalty above the fraud penalty", async function () {
      const [a] = await ethers.getSigners();
      const token = await ethers.deployContract("MockToken");
      const identity = await ethers.deployContract("MockIdentity");
      const bad = { ...PARAMS, missPenalty: PARAMS.fraudPenalty + 1n };
      const F = await ethers.getContractFactory("AgentValidation");
      await expect(F.deploy(token.target, identity.target, a.address, a.address, bad)).to.be.revertedWithCustomError(F, "BadParams");
    });
  });

  describe("bonds", function () {
    it("bonds, queues an unbond and withdraws only after the delay", async function () {
      const { av, token, validator } = await loadFixture(bonded);
      await av.connect(validator).requestUnbond(e(40_000));
      await expect(av.connect(validator).withdraw()).to.be.revertedWithCustomError(av, "TooEarly");
      await time.increase(PARAMS.unbondDelay);
      await expect(av.connect(validator).withdraw()).to.changeTokenBalance(token, validator, e(40_000));
      const v = await av.validators(validator.address);
      expect(v.bonded).to.equal(e(60_000));
      expect(v.unbonding).to.equal(0n);
    });

    it("cannot unbond the part locked by an open check", async function () {
      const { av, validator } = await loadFixture(accepted);
      expect(await av.available(validator.address)).to.equal(e(50_000));
      await expect(av.connect(validator).requestUnbond(e(50_001))).to.be.revertedWithCustomError(av, "InsufficientBond");
      await av.connect(validator).requestUnbond(e(50_000));
    });

    it("reverts a withdraw with nothing queued", async function () {
      const { av, validator } = await loadFixture(bonded);
      await expect(av.connect(validator).withdraw()).to.be.revertedWithCustomError(av, "NothingToWithdraw");
    });
  });

  describe("requests", function () {
    it("lets only the agent owner request, and takes the fee", async function () {
      const { av, token, owner, validator, stranger } = await loadFixture(bonded);
      await expect(av.connect(stranger).request(AGENT, ENDPOINT_LIVE, validator.address, FEE)).to.be.revertedWithCustomError(av, "NotAgentOwner");
      await expect(av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator.address, FEE)).to.changeTokenBalances(token, [owner, av], [-FEE, FEE]);
      const c = await av.checks(1n);
      expect(c.status).to.equal(Status.Requested);
      expect(c.owner).to.equal(owner.address);
    });

    it("does not let the owner validate its own agent", async function () {
      const { av, owner } = await loadFixture(bonded);
      await expect(av.connect(owner).request(AGENT, ENDPOINT_LIVE, owner.address, FEE)).to.be.revertedWithCustomError(av, "BadParams");
    });

    it("refunds the fee when the owner cancels before acceptance", async function () {
      const { av, token, owner, id } = await loadFixture(requested);
      await expect(av.connect(owner).cancel(id)).to.changeTokenBalance(token, owner, FEE);
      expect((await av.checks(id)).status).to.equal(Status.Cancelled);
    });

    it("cannot be cancelled after acceptance", async function () {
      const { av, owner, id } = await loadFixture(accepted);
      await expect(av.connect(owner).cancel(id)).to.be.revertedWithCustomError(av, "BadStatus");
    });
  });

  describe("accept and respond", function () {
    it("locks the fraud penalty on accept", async function () {
      const { av, validator } = await loadFixture(accepted);
      expect((await av.validators(validator.address)).locked).to.equal(PARAMS.fraudPenalty);
    });

    it("requires the minimum bond", async function () {
      const { av, owner, validator2 } = await loadFixture(bonded);
      await av.connect(validator2).bond(PARAMS.minBond - 1n);
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator2.address, FEE);
      await expect(av.connect(validator2).accept(1n)).to.be.revertedWithCustomError(av, "InsufficientBond");
    });

    it("limits open checks to what the bond can cover", async function () {
      const { av, owner, validator } = await loadFixture(accepted);
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator.address, FEE);
      await av.connect(validator).accept(2n); // 100k bond covers two 50k locks
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator.address, FEE);
      await expect(av.connect(validator).accept(3n)).to.be.revertedWithCustomError(av, "InsufficientBond");
    });

    it("rejects acceptance after the accept window", async function () {
      const { av, validator, id } = await loadFixture(requested);
      await time.increase(PARAMS.acceptWindow + 1);
      await expect(av.connect(validator).accept(id)).to.be.revertedWithCustomError(av, "TooLate");
    });

    it("only the chosen validator can accept or respond", async function () {
      const { av, stranger, id } = await loadFixture(requested);
      await expect(av.connect(stranger).accept(id)).to.be.revertedWithCustomError(av, "NotValidator");
    });

    it("rejects a response after the deadline", async function () {
      const { av, validator, id } = await loadFixture(accepted);
      await time.increase(PARAMS.responseWindow + 1);
      await expect(av.connect(validator).respond(id, true, ethers.ZeroHash, "")).to.be.revertedWithCustomError(av, "TooLate");
    });
  });

  describe("finalize", function () {
    it("splits the fee 80 / 15 / 5, releases the lock and sets the badge", async function () {
      const { av, token, validator, treasury, stranger, id } = await loadFixture(responded);
      await expect(av.connect(stranger).finalize(id)).to.be.revertedWithCustomError(av, "TooEarly");
      await time.increase(PARAMS.challengeWindow + 1);
      await expect(av.connect(stranger).finalize(id)).to.changeTokenBalances(
        token,
        [validator, BURN, treasury],
        [(FEE * 8000n) / 10000n, (FEE * 1500n) / 10000n, (FEE * 500n) / 10000n]
      );
      expect((await av.validators(validator.address)).locked).to.equal(0n);
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(true);
      expect(await av.latestCheck(AGENT, ENDPOINT_LIVE)).to.equal(id);
    });

    it("lets the badge expire after the validity period", async function () {
      const { av, stranger, id } = await loadFixture(responded);
      await time.increase(PARAMS.challengeWindow + 1);
      await av.connect(stranger).finalize(id);
      await time.increase(PARAMS.validity);
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(false);
    });

    it("clears the badge when a later check fails", async function () {
      const { av, owner, validator, stranger, id } = await loadFixture(responded);
      await time.increase(PARAMS.challengeWindow + 1);
      await av.connect(stranger).finalize(id);
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(true);
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator.address, FEE);
      await av.connect(validator).accept(2n);
      await av.connect(validator).respond(2n, false, ethers.id("down"), "ipfs://down");
      await time.increase(PARAMS.challengeWindow + 1);
      await av.connect(stranger).finalize(2n);
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(false);
    });

    it("keeps the newest answer when an older pass is finalized after a newer fail", async function () {
      const { av, owner, validator, validator2, stranger, id } = await loadFixture(responded);
      await av.connect(validator2).bond(PARAMS.minBond);
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator2.address, FEE);
      await av.connect(validator2).accept(2n);
      await time.increase(H);
      await av.connect(validator2).respond(2n, false, ethers.id("down"), "ipfs://down");
      await time.increase(PARAMS.challengeWindow + 1);
      await av.connect(stranger).finalize(2n); // newer fail first
      await av.connect(stranger).finalize(id); // then the older pass
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(false);
      expect(await av.latestCheck(AGENT, ENDPOINT_LIVE)).to.equal(2n);
    });

    it("counts validity from the answer, not from finalize", async function () {
      const { av, stranger, id } = await loadFixture(responded);
      const respondedAt = (await av.checks(id)).respondedAt;
      await time.increase(PARAMS.challengeWindow + 5 * DAY);
      await av.connect(stranger).finalize(id);
      expect(await av.verifiedUntil(AGENT, ENDPOINT_LIVE)).to.equal(respondedAt + BigInt(PARAMS.validity));
    });
  });

  describe("missed deadline", function () {
    it("can only be slashed after the response deadline", async function () {
      const { av, stranger, id } = await loadFixture(accepted);
      await expect(av.connect(stranger).slashMissed(id)).to.be.revertedWithCustomError(av, "TooEarly");
    });

    it("refunds the owner, pays it half the penalty and burns the rest; anyone can call", async function () {
      const { av, token, owner, validator, stranger, id } = await loadFixture(accepted);
      await time.increase(PARAMS.responseWindow + 1);
      const half = PARAMS.missPenalty / 2n;
      await expect(av.connect(stranger).slashMissed(id)).to.changeTokenBalances(token, [owner, BURN, av], [FEE + half, half, -(FEE + PARAMS.missPenalty)]);
      const v = await av.validators(validator.address);
      expect(v.bonded).to.equal(PARAMS.minBond - PARAMS.missPenalty);
      expect(v.locked).to.equal(0n);
      expect((await av.checks(id)).status).to.equal(Status.Missed);
      await expect(av.connect(stranger).slashMissed(id)).to.be.revertedWithCustomError(av, "BadStatus");
    });
  });

  describe("challenges", function () {
    it("takes the challenge bond and blocks finalize", async function () {
      const { av, stranger, id } = await loadFixture(challenged);
      expect((await av.checks(id)).status).to.equal(Status.Challenged);
      await time.increase(PARAMS.challengeWindow + 1);
      await expect(av.connect(stranger).finalize(id)).to.be.revertedWithCustomError(av, "BadStatus");
    });

    it("cannot be raised after the challenge window or by the validator", async function () {
      const { av, validator, challenger, id } = await loadFixture(responded);
      await expect(av.connect(validator).challenge(id)).to.be.revertedWithCustomError(av, "BadParams");
      await time.increase(PARAMS.challengeWindow + 1);
      await expect(av.connect(challenger).challenge(id)).to.be.revertedWithCustomError(av, "TooLate");
    });

    it("only the arbiter resolves", async function () {
      const { av, stranger, id } = await loadFixture(challenged);
      await expect(av.connect(stranger).resolve(id, true)).to.be.revertedWithCustomError(av, "NotArbiter");
    });

    it("upheld: refunds the owner, rewards the challenger, burns, no badge", async function () {
      const { av, token, owner, validator, challenger, arbiter, id } = await loadFixture(challenged);
      const half = PARAMS.fraudPenalty / 2n;
      await expect(av.connect(arbiter).resolve(id, false)).to.changeTokenBalances(
        token,
        [owner, challenger, BURN],
        [FEE, PARAMS.challengeBond + half, half]
      );
      const v = await av.validators(validator.address);
      expect(v.bonded).to.equal(PARAMS.minBond - PARAMS.fraudPenalty);
      expect(v.locked).to.equal(0n);
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(false);
      expect((await av.checks(id)).status).to.equal(Status.Overturned);
    });

    it("rejected: settles the check and splits the challenger's bond", async function () {
      const { av, token, validator, challenger, arbiter, treasury, id } = await loadFixture(challenged);
      const half = PARAMS.challengeBond / 2n;
      await expect(av.connect(arbiter).resolve(id, true)).to.changeTokenBalances(
        token,
        [validator, challenger, BURN, treasury],
        [(FEE * 8000n) / 10000n + half, 0n, (FEE * 1500n) / 10000n + half, (FEE * 500n) / 10000n]
      );
      expect(await av.isVerified(AGENT, ENDPOINT_LIVE)).to.equal(true);
      expect((await av.checks(id)).status).to.equal(Status.Finalized);
    });
  });

  describe("accounting", function () {
    it("holds exactly bonds plus open fees and challenge bonds", async function () {
      const { av, token, validator, validator2, owner, challenger, arbiter } = await loadFixture(challenged);
      await av.connect(validator2).bond(PARAMS.minBond);
      await av.connect(owner).request(AGENT, ENDPOINT_LIVE, validator2.address, FEE);
      let held = PARAMS.minBond * 2n + FEE * 2n + PARAMS.challengeBond;
      expect(await token.balanceOf(av.target)).to.equal(held);
      await av.connect(arbiter).resolve(1n, false);
      const v1 = await av.validators(validator.address);
      const v2 = await av.validators(validator2.address);
      expect(await token.balanceOf(av.target)).to.equal(v1.bonded + v1.unbonding + v2.bonded + v2.unbonding + FEE);
    });
  });
});
