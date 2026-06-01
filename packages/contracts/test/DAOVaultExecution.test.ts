import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import type { DAOVault, DAOVaultHarness } from '../typechain-types';

describe('DAOVault proposal execution', () => {
  const spendingType = 0;
  const terminationType = 1;
  const defaultApproval = 0;
  const executableStatus = 3n;
  const executedStatus = 4n;
  const executionFailedStatus = 5n;
  const insufficientBalanceReason = 1;
  const transferFailedReason = 2;

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
        hashText(`execute proposal ${proposalId.toString()}`),
      );
    await vault.connect(proposer).vote(proposalId, true);
    await vault.connect(yesVoter).vote(proposalId, true);
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executableStatus);

    return { proposalId, amount };
  }

  it('executes an approved spending proposal and emits ProposalExecuted', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const depositAmount = ethers.parseEther('1');
    const { proposalId, amount } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );
    const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

    await vault.connect(creator).deposit({ value: depositAmount });

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.emit(vault, 'ProposalExecuted')
      .withArgs(await vault.getAddress(), proposalId, recipient.address, amount, anyValue);

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executedStatus);
    expect(await vault.currentBalance()).to.equal(depositAmount - amount);
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(
      recipientBalanceBefore + amount,
    );
  });

  it('rejects execution by non-members and non-executable proposals', async () => {
    const { creator, memberA, outsider, recipient, vault } = await deployVault();
    const { proposalId } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );
    const votingProposalId = (await vault.proposalCount()) + 1n;

    await vault.createProposal(
      spendingType,
      ethers.parseEther('0.1'),
      recipient.address,
      await futureDeadline(),
      defaultApproval,
      hashText('still voting'),
    );

    await expect(vault.connect(outsider).executeProposal(proposalId))
      .to.be.revertedWithCustomError(vault, 'NotMember')
      .withArgs(outsider.address);
    await expect(vault.connect(memberA).executeProposal(votingProposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotExecutable')
      .withArgs(0);
  });

  it('records insufficient balance as execution failure without reverting', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const { proposalId, amount } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.emit(vault, 'ProposalExecutionFailed')
      .withArgs(
        await vault.getAddress(),
        proposalId,
        recipient.address,
        amount,
        insufficientBalanceReason,
        anyValue,
      );

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executionFailedStatus);
    expect(await vault.currentBalance()).to.equal(0n);
  });

  it('records recipient transfer failure without reverting', async () => {
    const { creator, memberA, vault } = await deployVault();
    const rejectingRecipient = await ethers.deployContract('RejectEther');
    const depositAmount = ethers.parseEther('1');
    const { proposalId, amount } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      await rejectingRecipient.getAddress(),
    );

    await vault.connect(creator).deposit({ value: depositAmount });

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.emit(vault, 'ProposalExecutionFailed')
      .withArgs(
        await vault.getAddress(),
        proposalId,
        await rejectingRecipient.getAddress(),
        amount,
        transferFailedReason,
        anyValue,
      );

    expect((await vault.getProposal(proposalId)).proposalStatus).to.equal(executionFailedStatus);
    expect(await vault.currentBalance()).to.equal(depositAmount);
  });

  it('prevents re-execution after success or failure', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const successful = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );

    await vault.connect(creator).deposit({ value: ethers.parseEther('1') });
    await vault.connect(memberA).executeProposal(successful.proposalId);

    await expect(vault.connect(memberA).executeProposal(successful.proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotExecutable')
      .withArgs(executedStatus);

    const failed = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
      ethers.parseEther('0.6'),
    );
    await vault.connect(memberA).executeProposal(failed.proposalId);

    await expect(vault.connect(memberA).executeProposal(failed.proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotExecutable')
      .withArgs(executionFailedStatus);
  });

  it('blocks spending execution while the DAO is not active', async () => {
    const { creator, memberA, recipient, vault } = await deployHarness();
    const { proposalId } = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );

    await vault.connect(creator).deposit({ value: ethers.parseEther('1') });
    await vault.setStatusForTest(1);

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(1);

    await vault.setStatusForTest(2);

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(2);
  });

  it('rejects termination proposals in the spending execution path', async () => {
    const { creator, memberA, vault } = await deployHarness();
    const proposalId = (await vault.proposalCount()) + 1n;
    const deadline = await futureDeadline();

    await vault.createProposal(
      terminationType,
      0,
      ethers.ZeroAddress,
      deadline,
      defaultApproval,
      hashText('termination executable'),
    );
    await vault.connect(creator).vote(proposalId, true);
    await vault.connect(memberA).vote(proposalId, true);
    await time.increaseTo(deadline);
    await vault.finalizeProposal(proposalId);
    await vault.setStatusForTest(0);

    await expect(vault.connect(memberA).executeProposal(proposalId))
      .to.be.revertedWithCustomError(vault, 'ProposalNotSpending')
      .withArgs(terminationType);
  });

  it('allows creating a termination proposal after a spending execution failure', async () => {
    const { creator, memberA, recipient, vault } = await deployVault();
    const failed = await createExecutableSpendingProposal(
      vault,
      creator,
      memberA,
      recipient.address,
    );

    await vault.connect(memberA).executeProposal(failed.proposalId);

    await expect(
      vault.createProposal(
        terminationType,
        0,
        ethers.ZeroAddress,
        await futureDeadline(),
        defaultApproval,
        hashText('termination after failure'),
      ),
    ).to.emit(vault, 'ProposalCreated');
  });
});
