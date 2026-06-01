import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import type { DAOVault } from '../typechain-types';

describe('DAOVault voting and finalization', () => {
  const spendingType = 0;
  const terminationType = 1;
  const defaultApproval = 0;
  const unanimousApproval = 1;
  const majorityRule = 0;
  const twoThirdsRule = 1;
  const votingStatus = 0n;
  const canceledStatus = 1n;
  const rejectedStatus = 2n;
  const executableStatus = 3n;

  function hashText(value: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(value));
  }

  async function futureDeadline(secondsFromNow = 3600) {
    return (await time.latest()) + secondsFromNow;
  }

  async function deployVault(defaultApprovalRule = majorityRule) {
    const [creator, memberA, memberB, outsider, recipient] = await ethers.getSigners();
    const vault = (await ethers.deployContract('DAOVault', [
      'Blockchain Club',
      creator.address,
      [memberA.address, memberB.address],
      defaultApprovalRule,
    ])) as unknown as DAOVault;

    return { creator, memberA, memberB, outsider, recipient, vault };
  }

  async function createSpendingProposal(
    vault: DAOVault,
    proposer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    recipient: string,
    approvalType = defaultApproval,
  ) {
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault
      .connect(proposer)
      .createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient,
        deadline,
        approvalType,
        hashText(`proposal ${proposalId.toString()}`),
      );

    return { proposalId, deadline };
  }

  async function finalizeAfterDeadline(vault: DAOVault, proposalId: bigint, deadline: number) {
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);
  }

  it('allows a member to vote once and emits VoteCast', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const { proposalId } = await createSpendingProposal(vault, memberA, recipient.address);

    await expect(vault.connect(memberA).vote(proposalId, true))
      .to.emit(vault, 'VoteCast')
      .withArgs(await vault.getAddress(), proposalId, memberA.address, true, anyValue);

    const proposal = await vault.getProposal(proposalId);
    expect(proposal.yesVotes).to.equal(1n);
    expect(proposal.noVotes).to.equal(0n);
    expect(await vault.hasVoted(proposalId, memberA.address)).to.equal(true);
    expect(await vault.getVote(proposalId, memberA.address)).to.deep.equal([true, true]);
  });

  it('rejects duplicate votes, non-member votes, late votes, and votes on canceled proposals', async () => {
    const { memberA, memberB, outsider, recipient, vault } = await deployVault();
    const { proposalId, deadline } = await createSpendingProposal(
      vault,
      memberA,
      recipient.address,
    );

    await vault.connect(memberA).vote(proposalId, true);

    await expect(vault.connect(memberA).vote(proposalId, false))
      .to.be.revertedWithCustomError(vault, 'AlreadyVoted')
      .withArgs(memberA.address);
    await expect(vault.connect(outsider).vote(proposalId, true))
      .to.be.revertedWithCustomError(vault, 'NotMember')
      .withArgs(outsider.address);

    const { proposalId: canceledProposalId } = await createSpendingProposal(
      vault,
      memberA,
      recipient.address,
    );
    await vault.connect(memberA).cancelProposal(canceledProposalId, hashText('cancel'));
    await expect(vault.connect(memberB).vote(canceledProposalId, true))
      .to.be.revertedWithCustomError(vault, 'ProposalNotVoting')
      .withArgs(canceledStatus);

    await time.increaseTo(deadline);

    await expect(vault.connect(memberB).vote(proposalId, true)).to.be.revertedWithCustomError(
      vault,
      'ProposalDeadlinePassed',
    );
  });

  it('prevents finalization before the deadline and lets any account finalize after the deadline', async () => {
    const { memberA, memberB, outsider, recipient, vault } = await deployVault();
    const { proposalId, deadline } = await createSpendingProposal(
      vault,
      memberA,
      recipient.address,
    );

    await vault.connect(memberA).vote(proposalId, true);
    await vault.connect(memberB).vote(proposalId, true);

    await expect(
      vault.connect(outsider).finalizeProposal(proposalId),
    ).to.be.revertedWithCustomError(vault, 'ProposalDeadlineNotReached');

    await time.increaseTo(deadline);

    await expect(vault.connect(outsider).finalizeProposal(proposalId))
      .to.emit(vault, 'ProposalFinalized')
      .withArgs(await vault.getAddress(), proposalId, executableStatus, 2, 0, anyValue);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);
  });

  it('finalizes majority approval using yesVotes * 2 > memberCount', async () => {
    const { creator, memberA, memberB, recipient, vault } = await deployVault(majorityRule);
    const approved = await createSpendingProposal(vault, creator, recipient.address);

    await vault.connect(creator).vote(approved.proposalId, true);
    await vault.connect(memberA).vote(approved.proposalId, true);
    await finalizeAfterDeadline(vault, approved.proposalId, approved.deadline);

    expect((await vault.getProposal(approved.proposalId)).proposalStatus).to.equal(
      executableStatus,
    );

    const rejected = await createSpendingProposal(vault, creator, recipient.address);

    await vault.connect(creator).vote(rejected.proposalId, true);
    await vault.connect(memberA).vote(rejected.proposalId, false);
    await vault.connect(memberB).vote(rejected.proposalId, false);
    await finalizeAfterDeadline(vault, rejected.proposalId, rejected.deadline);

    expect((await vault.getProposal(rejected.proposalId)).proposalStatus).to.equal(rejectedStatus);
  });

  it('finalizes two-thirds approval using yesVotes * 3 >= memberCount * 2', async () => {
    const { creator, memberA, memberB, recipient, vault } = await deployVault(twoThirdsRule);
    const approved = await createSpendingProposal(vault, creator, recipient.address);

    await vault.connect(creator).vote(approved.proposalId, true);
    await vault.connect(memberA).vote(approved.proposalId, true);
    await finalizeAfterDeadline(vault, approved.proposalId, approved.deadline);

    expect((await vault.getProposal(approved.proposalId)).proposalStatus).to.equal(
      executableStatus,
    );

    const rejected = await createSpendingProposal(vault, creator, recipient.address);

    await vault.connect(creator).vote(rejected.proposalId, true);
    await vault.connect(memberA).vote(rejected.proposalId, false);
    await vault.connect(memberB).vote(rejected.proposalId, false);
    await finalizeAfterDeadline(vault, rejected.proposalId, rejected.deadline);

    expect((await vault.getProposal(rejected.proposalId)).proposalStatus).to.equal(rejectedStatus);
  });

  it('lets unanimous approval override the DAO default approval rule', async () => {
    const { creator, memberA, memberB, recipient, vault } = await deployVault(majorityRule);
    const rejected = await createSpendingProposal(
      vault,
      creator,
      recipient.address,
      unanimousApproval,
    );

    await vault.connect(creator).vote(rejected.proposalId, true);
    await vault.connect(memberA).vote(rejected.proposalId, true);
    await finalizeAfterDeadline(vault, rejected.proposalId, rejected.deadline);

    expect((await vault.getProposal(rejected.proposalId)).proposalStatus).to.equal(rejectedStatus);

    const approved = await createSpendingProposal(
      vault,
      creator,
      recipient.address,
      unanimousApproval,
    );

    await vault.connect(creator).vote(approved.proposalId, true);
    await vault.connect(memberA).vote(approved.proposalId, true);
    await vault.connect(memberB).vote(approved.proposalId, true);
    await finalizeAfterDeadline(vault, approved.proposalId, approved.deadline);

    expect((await vault.getProposal(approved.proposalId)).proposalStatus).to.equal(
      executableStatus,
    );
  });

  it('rejects finalization of canceled proposals and already finalized proposals', async () => {
    const { creator, recipient, vault } = await deployVault();
    const canceled = await createSpendingProposal(vault, creator, recipient.address);

    await vault.cancelProposal(canceled.proposalId, hashText('cancel'));
    await time.increaseTo(canceled.deadline);

    await expect(vault.finalizeProposal(canceled.proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotVoting')
      .withArgs(canceledStatus);

    const finalized = await createSpendingProposal(vault, creator, recipient.address);

    await vault.connect(creator).vote(finalized.proposalId, true);
    await finalizeAfterDeadline(vault, finalized.proposalId, finalized.deadline);

    await expect(vault.finalizeProposal(finalized.proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotVoting')
      .withArgs(rejectedStatus);
  });

  it('does not move funds while voting or finalizing', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const depositAmount = ethers.parseEther('1');
    const { proposalId, deadline } = await createSpendingProposal(
      vault,
      creator,
      recipient.address,
    );

    await vault.connect(creator).deposit({ value: depositAmount });
    await vault.connect(creator).vote(proposalId, true);
    await vault.connect(memberA).vote(proposalId, true);

    expect(await vault.currentBalance()).to.equal(depositAmount);

    await finalizeAfterDeadline(vault, proposalId, deadline);

    expect(await vault.currentBalance()).to.equal(depositAmount);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(depositAmount);
  });

  it('restores DAO active status when a termination proposal is rejected', async () => {
    const { creator, memberA, memberB, vault } = await deployVault();
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault.createProposal(
      terminationType,
      0,
      ethers.ZeroAddress,
      deadline,
      defaultApproval,
      hashText('reject termination'),
    );
    await vault.connect(creator).vote(proposalId, true);
    await vault.connect(memberA).vote(proposalId, false);
    await vault.connect(memberB).vote(proposalId, false);
    await finalizeAfterDeadline(vault, proposalId, deadline);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(rejectedStatus);
    expect(await vault.status()).to.equal(0n);
  });

  it('keeps DAO in termination voting status when a termination proposal is executable', async () => {
    const { creator, memberA, vault } = await deployVault();
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault.createProposal(
      terminationType,
      0,
      ethers.ZeroAddress,
      deadline,
      defaultApproval,
      hashText('approve termination'),
    );
    await vault.connect(creator).vote(proposalId, true);
    await vault.connect(memberA).vote(proposalId, true);
    await finalizeAfterDeadline(vault, proposalId, deadline);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);
    expect(await vault.status()).to.equal(1n);
  });
});
