import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import type { DAOVault, DAOVaultHarness } from '../typechain-types';

describe('DAOVault termination and evidence', () => {
  const spendingType = 0;
  const terminationType = 1;
  const defaultApproval = 0;
  const executableStatus = 3n;
  const executedStatus = 4n;
  const executionFailedStatus = 5n;
  const activeStatus = 0n;
  const terminationVotingStatus = 1n;
  const terminatedStatus = 2n;

  function hashText(value: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(value));
  }

  async function futureDeadline(secondsFromNow = 3600) {
    return (await time.latest()) + secondsFromNow;
  }

  async function deployVault() {
    const [creator, memberA, memberB, outsider, recipient] = await ethers.getSigners();
    const vault = (await ethers.deployContract('DAOVault', [
      'Blockchain Club',
      creator.address,
      [memberA.address, memberB.address],
      defaultApproval,
    ])) as unknown as DAOVault;

    return { creator, memberA, memberB, outsider, recipient, vault };
  }

  async function deployHarness() {
    const [creator, memberA, memberB, outsider, recipient] = await ethers.getSigners();
    const vault = (await ethers.deployContract('DAOVaultHarness', [
      'Blockchain Club',
      creator.address,
      [memberA.address, memberB.address],
      defaultApproval,
    ])) as unknown as DAOVaultHarness;

    return { creator, memberA, memberB, outsider, recipient, vault };
  }

  async function createExecutableSpendingProposal(
    vault: DAOVault,
    proposer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    yesVoter: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    recipient: string,
    amount = ethers.parseEther('0.5'),
  ) {
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault
      .connect(proposer)
      .createProposal(
        spendingType,
        amount,
        recipient,
        deadline,
        defaultApproval,
        hashText(`spending ${proposalId.toString()}`),
      );
    await vault.connect(proposer).vote(proposalId, true);
    await vault.connect(yesVoter).vote(proposalId, true);
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);

    return { proposalId, amount };
  }

  async function createExecutableTerminationProposal(
    vault: DAOVault,
    proposer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    yesVoter: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  ) {
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault
      .connect(proposer)
      .createProposal(
        terminationType,
        0,
        ethers.ZeroAddress,
        deadline,
        defaultApproval,
        hashText(`termination ${proposalId.toString()}`),
      );
    await vault.connect(proposer).vote(proposalId, true);
    await vault.connect(yesVoter).vote(proposalId, true);
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);

    expect(await vault.status()).to.equal(terminationVotingStatus);
    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);

    return { proposalId };
  }

  it('executes an approved termination proposal and refunds all members equally', async () => {
    const { creator, memberA, memberB, vault } = await deployVault();
    const depositAmount = ethers.parseEther('1');
    const refundPerMember = depositAmount / 3n;
    const remainderWei = depositAmount - refundPerMember * 3n;

    await vault.connect(creator).deposit({ value: depositAmount });
    const { proposalId } = await createExecutableTerminationProposal(vault, creator, memberA);
    const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);
    const memberABalanceBefore = await ethers.provider.getBalance(memberA.address);

    await expect(vault.connect(memberB).executeTermination(proposalId))
      .to.emit(vault, 'TerminationExecuted')
      .withArgs(
        await vault.getAddress(),
        proposalId,
        3,
        refundPerMember,
        remainderWei,
        creator.address,
        anyValue,
      );

    expect(await ethers.provider.getBalance(creator.address)).to.equal(
      creatorBalanceBefore + refundPerMember + remainderWei,
    );
    expect(await ethers.provider.getBalance(memberA.address)).to.equal(
      memberABalanceBefore + refundPerMember,
    );
    expect(await vault.status()).to.equal(terminatedStatus);
    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executedStatus);
    expect(await vault.currentBalance()).to.equal(0n);
  });

  it('keeps DAO state and balance when any member refund fails', async () => {
    const [creator, memberA] = await ethers.getSigners();
    const rejectingMember = await ethers.deployContract('RejectEther');
    const vault = (await ethers.deployContract('DAOVault', [
      'Blockchain Club',
      creator.address,
      [memberA.address, await rejectingMember.getAddress()],
      defaultApproval,
    ])) as unknown as DAOVault;
    const depositAmount = ethers.parseEther('1');

    await vault.connect(creator).deposit({ value: depositAmount });
    const { proposalId } = await createExecutableTerminationProposal(vault, creator, memberA);

    await expect(
      vault.connect(memberA).executeTermination(proposalId),
    ).to.be.revertedWithCustomError(vault, 'TerminationTransferFailed');

    expect(await vault.status()).to.equal(terminationVotingStatus);
    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);
    expect(await vault.currentBalance()).to.equal(depositAmount);
  });

  it('blocks non-members, non-termination proposals, and non-executable termination proposals', async () => {
    const { memberA, outsider, vault } = await deployVault();
    const terminationProposalId = (await vault.proposalCount()) + 1n;

    await vault.createProposal(
      terminationType,
      0,
      ethers.ZeroAddress,
      await futureDeadline(),
      defaultApproval,
      hashText('not executable termination'),
    );

    await expect(vault.connect(outsider).executeTermination(terminationProposalId))
      .to.be.revertedWithCustomError(vault, 'NotMember')
      .withArgs(outsider.address);
    await expect(vault.connect(memberA).executeTermination(terminationProposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotExecutable')
      .withArgs(0);
  });

  it('rejects spending proposals in the termination execution path', async () => {
    const { creator, memberA, recipient, vault } = await deployHarness();
    const spending = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );

    await vault.setStatusForTest(terminationVotingStatus);

    await expect(vault.connect(memberA).executeTermination(spending.proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotTermination')
      .withArgs(spendingType);
  });

  it('blocks deposits, proposals, and spending execution after termination', async () => {
    const { creator, memberA, memberB, recipient, vault } = await deployVault();
    const spending = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
      ethers.parseEther('0.1'),
    );

    await vault.connect(creator).deposit({ value: ethers.parseEther('1') });
    await vault.connect(memberA).executeProposal(spending.proposalId);

    const { proposalId } = await createExecutableTerminationProposal(vault, creator, memberA);
    await vault.connect(memberB).executeTermination(proposalId);

    await expect(vault.connect(creator).deposit({ value: ethers.parseEther('0.1') }))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(terminatedStatus);
    await expect(
      vault.createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        await futureDeadline(),
        defaultApproval,
        hashText('blocked after termination'),
      ),
    )
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(terminatedStatus);
    await expect(vault.connect(memberA).executeProposal(spending.proposalId))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(terminatedStatus);
  });

  it('registers evidence hashes only for executed spending proposals by their proposer', async () => {
    const { creator, memberA, outsider, recipient, vault } = await deployVault();
    const { proposalId } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );
    const evidenceHash = hashText('receipt sha-256 value');

    await vault.connect(creator).deposit({ value: ethers.parseEther('1') });
    await vault.connect(memberA).executeProposal(proposalId);

    await expect(vault.connect(creator).registerEvidenceHash(proposalId, evidenceHash))
      .to.emit(vault, 'EvidenceHashRegistered')
      .withArgs(await vault.getAddress(), proposalId, evidenceHash, creator.address, anyValue);

    expect(await vault.getEvidenceHashes(proposalId)).to.deep.equal([evidenceHash]);
    expect(await vault.currentBalance()).to.equal(ethers.parseEther('0.5'));

    await expect(vault.connect(outsider).registerEvidenceHash(proposalId, hashText('outsider')))
      .to.be.revertedWithCustomError(vault, 'NotProposer')
      .withArgs(outsider.address);
    await expect(
      vault.connect(creator).registerEvidenceHash(proposalId, ethers.ZeroHash),
    ).to.be.revertedWithCustomError(vault, 'InvalidEvidenceHash');
  });

  it('rejects evidence hashes for unexecuted, failed, and termination proposals', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const pendingSpendingId = (await vault.proposalCount()) + 1n;

    await vault.createProposal(
      spendingType,
      ethers.parseEther('0.1'),
      recipient.address,
      await futureDeadline(),
      defaultApproval,
      hashText('pending spending'),
    );

    await expect(
      vault.registerEvidenceHash(pendingSpendingId, hashText('too early')),
    ).to.be.revertedWithCustomError(vault, 'EvidenceRegistrationNotAllowed');
    await vault.cancelProposal(pendingSpendingId, hashText('cancel pending spending'));

    const failed = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
      ethers.parseEther('1'),
    );
    await vault.executeProposal(failed.proposalId);

    expect((await vault.getProposal(failed.proposalId)).proposalStatus).to.equal(
      executionFailedStatus,
    );
    await expect(
      vault.registerEvidenceHash(failed.proposalId, hashText('failed spending')),
    ).to.be.revertedWithCustomError(vault, 'EvidenceRegistrationNotAllowed');

    const { proposalId: terminationProposalId } = await createExecutableTerminationProposal(
      vault,
      creator,
      memberA,
    );

    await expect(
      vault.registerEvidenceHash(terminationProposalId, hashText('termination evidence')),
    ).to.be.revertedWithCustomError(vault, 'EvidenceRegistrationNotAllowed');
  });

  it('restores active status when a termination proposal is rejected', async () => {
    const { creator, memberA, vault } = await deployVault();
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault.createProposal(
      terminationType,
      0,
      ethers.ZeroAddress,
      deadline,
      defaultApproval,
      hashText('rejected termination'),
    );
    await vault.connect(creator).vote(proposalId, false);
    await vault.connect(memberA).vote(proposalId, false);
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);

    expect(await vault.status()).to.equal(activeStatus);
  });
});
