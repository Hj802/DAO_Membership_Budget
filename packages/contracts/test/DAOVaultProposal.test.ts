import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import type { DAOVault } from '../typechain-types';

describe('DAOVault proposals', () => {
  const spendingType = 0;
  const terminationType = 1;
  const defaultApproval = 0;
  const unanimousApproval = 1;

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

  it('creates a spending proposal with required fields and emits the event', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const amount = ethers.parseEther('0.5');
    const deadline = await futureDeadline();
    const contentHash = hashText('spending proposal');
    const proposalId = await vault
      .connect(memberA)
      .createProposal.staticCall(
        spendingType,
        amount,
        recipient.address,
        deadline,
        defaultApproval,
        contentHash,
      );

    await expect(
      vault
        .connect(memberA)
        .createProposal(
          spendingType,
          amount,
          recipient.address,
          deadline,
          defaultApproval,
          contentHash,
        ),
    )
      .to.emit(vault, 'ProposalCreated')
      .withArgs(
        await vault.getAddress(),
        proposalId,
        spendingType,
        memberA.address,
        amount,
        recipient.address,
        deadline,
        defaultApproval,
        contentHash,
      );

    const proposal = await vault.getProposal(proposalId);
    expect(proposal.proposalType).to.equal(spendingType);
    expect(proposal.proposer).to.equal(memberA.address);
    expect(proposal.amountWei).to.equal(amount);
    expect(proposal.recipient).to.equal(recipient.address);
    expect(proposal.deadline).to.equal(deadline);
    expect(proposal.approvalType).to.equal(defaultApproval);
    expect(proposal.proposalStatus).to.equal(0n);
    expect(proposal.contentHash).to.equal(contentHash);
    expect(await vault.proposalCount()).to.equal(1n);
  });

  it('rejects invalid spending proposal fields', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const deadline = await futureDeadline();
    const contentHash = hashText('invalid spending proposal');

    await expect(
      vault
        .connect(memberA)
        .createProposal(spendingType, 0, recipient.address, deadline, defaultApproval, contentHash),
    ).to.be.revertedWithCustomError(vault, 'InvalidSpendingAmount');
    await expect(
      vault
        .connect(memberA)
        .createProposal(
          spendingType,
          ethers.parseEther('0.1'),
          ethers.ZeroAddress,
          deadline,
          defaultApproval,
          contentHash,
        ),
    ).to.be.revertedWithCustomError(vault, 'InvalidRecipient');
  });

  it('creates a termination proposal with zero amount and zero recipient, then changes DAO status', async () => {
    const { memberA, vault } = await deployVault();
    const deadline = await futureDeadline();
    const contentHash = hashText('termination proposal');
    const proposalId = await vault
      .connect(memberA)
      .createProposal.staticCall(
        terminationType,
        0,
        ethers.ZeroAddress,
        deadline,
        unanimousApproval,
        contentHash,
      );

    await expect(
      vault
        .connect(memberA)
        .createProposal(
          terminationType,
          0,
          ethers.ZeroAddress,
          deadline,
          unanimousApproval,
          contentHash,
        ),
    )
      .to.emit(vault, 'ProposalCreated')
      .withArgs(
        await vault.getAddress(),
        proposalId,
        terminationType,
        memberA.address,
        0,
        ethers.ZeroAddress,
        deadline,
        unanimousApproval,
        contentHash,
      );

    const proposal = await vault.getProposal(proposalId);
    expect(proposal.proposalType).to.equal(terminationType);
    expect(proposal.amountWei).to.equal(0n);
    expect(proposal.recipient).to.equal(ethers.ZeroAddress);
    expect(await vault.status()).to.equal(1n);
  });

  it('rejects termination proposals with spending fields', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const deadline = await futureDeadline();
    const contentHash = hashText('invalid termination proposal');

    await expect(
      vault
        .connect(memberA)
        .createProposal(
          terminationType,
          ethers.parseEther('0.1'),
          ethers.ZeroAddress,
          deadline,
          defaultApproval,
          contentHash,
        ),
    ).to.be.revertedWithCustomError(vault, 'InvalidTerminationFields');
    await expect(
      vault
        .connect(memberA)
        .createProposal(
          terminationType,
          0,
          recipient.address,
          deadline,
          defaultApproval,
          contentHash,
        ),
    ).to.be.revertedWithCustomError(vault, 'InvalidTerminationFields');
  });

  it('rejects proposal creation from non-members and invalid common fields', async () => {
    const { outsider, recipient, vault } = await deployVault();
    const deadline = await futureDeadline();
    const contentHash = hashText('common validation');

    await expect(
      vault
        .connect(outsider)
        .createProposal(
          spendingType,
          ethers.parseEther('0.1'),
          recipient.address,
          deadline,
          defaultApproval,
          contentHash,
        ),
    )
      .to.be.revertedWithCustomError(vault, 'NotMember')
      .withArgs(outsider.address);
    await expect(
      vault.createProposal(
        2,
        ethers.parseEther('0.1'),
        recipient.address,
        deadline,
        defaultApproval,
        contentHash,
      ),
    ).to.be.revertedWithCustomError(vault, 'InvalidProposalType');
    await expect(
      vault.createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        deadline,
        2,
        contentHash,
      ),
    ).to.be.revertedWithCustomError(vault, 'InvalidApprovalType');
    await expect(
      vault.createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        deadline,
        defaultApproval,
        ethers.ZeroHash,
      ),
    ).to.be.revertedWithCustomError(vault, 'InvalidContentHash');
    await expect(
      vault.createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        await time.latest(),
        defaultApproval,
        contentHash,
      ),
    ).to.be.revertedWithCustomError(vault, 'InvalidDeadline');
  });

  it('blocks termination proposal creation while another voting proposal exists', async () => {
    const { memberA, recipient, vault } = await deployVault();

    await vault
      .connect(memberA)
      .createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        await futureDeadline(),
        defaultApproval,
        hashText('active spending'),
      );

    await expect(
      vault
        .connect(memberA)
        .createProposal(
          terminationType,
          0,
          ethers.ZeroAddress,
          await futureDeadline(),
          defaultApproval,
          hashText('blocked termination'),
        ),
    )
      .to.be.revertedWithCustomError(vault, 'ActiveProposalExists')
      .withArgs(1);
  });

  it('cancels a voting proposal by proposer and stores only the cancel reason hash', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const proposalId = await vault
      .connect(memberA)
      .createProposal.staticCall(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        await futureDeadline(),
        defaultApproval,
        hashText('cancelable spending'),
      );

    await vault
      .connect(memberA)
      .createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        await futureDeadline(),
        defaultApproval,
        hashText('cancelable spending'),
      );

    const cancelReasonHash = hashText('wrong amount');

    await expect(vault.connect(memberA).cancelProposal(proposalId, cancelReasonHash))
      .to.emit(vault, 'ProposalCanceled')
      .withArgs(await vault.getAddress(), proposalId, memberA.address, cancelReasonHash, anyValue);

    const proposal = await vault.getProposal(proposalId);
    expect(proposal.proposalStatus).to.equal(1n);
    expect(proposal.cancelReasonHash).to.equal(cancelReasonHash);
    expect(proposal.canceledAt).to.not.equal(0n);

    await expect(vault.connect(memberA).cancelProposal(proposalId, hashText('second cancel')))
      .to.be.revertedWithCustomError(vault, 'ProposalNotVoting')
      .withArgs(1);
  });

  it('rejects cancellation by non-proposer, after deadline, and with empty reason hash', async () => {
    const { memberA, memberB, recipient, vault } = await deployVault();
    const deadline = await futureDeadline();
    const proposalId = await vault
      .connect(memberA)
      .createProposal.staticCall(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        deadline,
        defaultApproval,
        hashText('protected spending'),
      );

    await vault
      .connect(memberA)
      .createProposal(
        spendingType,
        ethers.parseEther('0.1'),
        recipient.address,
        deadline,
        defaultApproval,
        hashText('protected spending'),
      );

    await expect(vault.connect(memberB).cancelProposal(proposalId, hashText('not mine')))
      .to.be.revertedWithCustomError(vault, 'NotProposer')
      .withArgs(memberB.address);
    await expect(
      vault.connect(memberA).cancelProposal(proposalId, ethers.ZeroHash),
    ).to.be.revertedWithCustomError(vault, 'InvalidCancelReasonHash');

    await time.increaseTo(deadline);

    await expect(
      vault.connect(memberA).cancelProposal(proposalId, hashText('too late')),
    ).to.be.revertedWithCustomError(vault, 'ProposalDeadlinePassed');
  });

  it('restores DAO active status when a termination proposal is canceled', async () => {
    const { memberA, recipient, vault } = await deployVault();
    const proposalId = await vault
      .connect(memberA)
      .createProposal.staticCall(
        terminationType,
        0,
        ethers.ZeroAddress,
        await futureDeadline(),
        defaultApproval,
        hashText('cancelable termination'),
      );

    await vault
      .connect(memberA)
      .createProposal(
        terminationType,
        0,
        ethers.ZeroAddress,
        await futureDeadline(),
        defaultApproval,
        hashText('cancelable termination'),
      );

    expect(await vault.status()).to.equal(1n);

    await vault.connect(memberA).cancelProposal(proposalId, hashText('continue dao'));

    expect(await vault.status()).to.equal(0n);

    await expect(
      vault
        .connect(memberA)
        .createProposal(
          spendingType,
          ethers.parseEther('0.1'),
          recipient.address,
          await futureDeadline(),
          defaultApproval,
          hashText('spending after termination cancel'),
        ),
    ).to.emit(vault, 'ProposalCreated');
  });

  it('blocks deposits and new spending proposals while termination voting is active', async () => {
    const { memberA, recipient, vault } = await deployVault();

    await vault
      .connect(memberA)
      .createProposal(
        terminationType,
        0,
        ethers.ZeroAddress,
        await futureDeadline(),
        defaultApproval,
        hashText('termination lock'),
      );

    await expect(vault.connect(memberA).deposit({ value: ethers.parseEther('0.1') }))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(1);
    await expect(
      vault
        .connect(memberA)
        .createProposal(
          spendingType,
          ethers.parseEther('0.1'),
          recipient.address,
          await futureDeadline(),
          defaultApproval,
          hashText('blocked spending'),
        ),
    )
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(1);
  });
});
