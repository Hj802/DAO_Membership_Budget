import { expect } from 'chai';
import { ethers } from 'hardhat';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import type { DAOFactory, DAOVault, DAOVaultHarness } from '../typechain-types';

describe('DAOVault deposits', () => {
  async function deployVault() {
    const [creator, memberA, memberB, outsider] = await ethers.getSigners();
    const vault = (await ethers.deployContract('DAOVault', [
      'Blockchain Club',
      creator.address,
      [memberA.address, memberB.address],
      0,
    ])) as unknown as DAOVault;

    return { creator, memberA, memberB, outsider, vault };
  }

  async function deployHarness() {
    const [creator, memberA] = await ethers.getSigners();
    const vault = (await ethers.deployContract('DAOVaultHarness', [
      'Blockchain Club',
      creator.address,
      [memberA.address],
      0,
    ])) as unknown as DAOVaultHarness;

    return { creator, memberA, vault };
  }

  it('allows a member to deposit and emits the resulting balance', async () => {
    const { memberA, vault } = await deployVault();
    const amount = ethers.parseEther('0.25');

    await expect(vault.connect(memberA).deposit({ value: amount }))
      .to.emit(vault, 'DepositReceived')
      .withArgs(await vault.getAddress(), memberA.address, amount, amount, anyValue);

    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(amount);
    expect(await vault.currentBalance()).to.equal(amount);
  });

  it('rejects deposits from non-members', async () => {
    const { outsider, vault } = await deployVault();

    await expect(vault.connect(outsider).deposit({ value: ethers.parseEther('0.1') }))
      .to.be.revertedWithCustomError(vault, 'NotMember')
      .withArgs(outsider.address);
  });

  it('rejects zero-value deposits from members', async () => {
    const { memberA, vault } = await deployVault();

    await expect(vault.connect(memberA).deposit({ value: 0 })).to.be.revertedWithCustomError(
      vault,
      'ZeroDeposit',
    );
  });

  it('rejects deposits while termination voting is active', async () => {
    const { memberA, vault } = await deployHarness();
    await vault.setStatusForTest(1);

    await expect(vault.connect(memberA).deposit({ value: ethers.parseEther('0.1') }))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(1);
  });

  it('rejects deposits after the DAO is terminated', async () => {
    const { memberA, vault } = await deployHarness();
    await vault.setStatusForTest(2);

    await expect(vault.connect(memberA).deposit({ value: ethers.parseEther('0.1') }))
      .to.be.revertedWithCustomError(vault, 'DaoNotActive')
      .withArgs(2);
  });

  it('accumulates deposits from multiple members', async () => {
    const { creator, memberA, memberB, vault } = await deployVault();
    const creatorDeposit = ethers.parseEther('0.2');
    const memberADeposit = ethers.parseEther('0.3');
    const memberBDeposit = ethers.parseEther('0.4');
    const expectedBalance = creatorDeposit + memberADeposit + memberBDeposit;

    await vault.connect(creator).deposit({ value: creatorDeposit });
    await vault.connect(memberA).deposit({ value: memberADeposit });
    await vault.connect(memberB).deposit({ value: memberBDeposit });

    expect(await vault.currentBalance()).to.equal(expectedBalance);
  });

  it('does not affect factory DAO indexes after a deposit', async () => {
    const [creator, memberA] = await ethers.getSigners();
    const factory = (await ethers.deployContract('DAOFactory')) as unknown as DAOFactory;
    const expectedDaoAddress = await factory.createDAO.staticCall(
      'Indexed DAO',
      [memberA.address],
      0,
    );

    await factory.createDAO('Indexed DAO', [memberA.address], 0);
    const vault = (await ethers.getContractAt(
      'DAOVault',
      expectedDaoAddress,
    )) as unknown as DAOVault;
    await vault.connect(memberA).deposit({ value: ethers.parseEther('0.1') });

    expect(await factory.getAllDAOs()).to.deep.equal([expectedDaoAddress]);
    expect(await factory.getDAOsByMember(creator.address)).to.deep.equal([expectedDaoAddress]);
    expect(await factory.getDAOsByMember(memberA.address)).to.deep.equal([expectedDaoAddress]);
  });
});
