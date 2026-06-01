import { expect } from 'chai';
import { ethers } from 'hardhat';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

describe('DAOFactory', () => {
  async function deployFactory() {
    const [creator, memberA, memberB, outsider] = await ethers.getSigners();
    const factory = await ethers.deployContract('DAOFactory');
    const vaultFactory = await ethers.getContractFactory('DAOVault');

    return { creator, memberA, memberB, outsider, factory, vaultFactory };
  }

  it('creates a DAO and records the creator as the first member', async () => {
    const { creator, memberA, memberB, factory } = await deployFactory();
    const additionalMembers = [memberA.address, memberB.address];
    const expectedDaoAddress = await factory.createDAO.staticCall(
      'Blockchain Club',
      additionalMembers,
      0,
    );

    await expect(factory.createDAO('Blockchain Club', additionalMembers, 0))
      .to.emit(factory, 'DAOCreated')
      .withArgs(expectedDaoAddress, creator.address, 'Blockchain Club', 3, 0, anyValue);

    const allDAOs = await factory.getAllDAOs();
    expect(allDAOs).to.deep.equal([expectedDaoAddress]);

    const dao = await ethers.getContractAt('DAOVault', expectedDaoAddress);
    expect(await dao.name()).to.equal('Blockchain Club');
    expect(await dao.creator()).to.equal(creator.address);
    expect(await dao.approvalRule()).to.equal(0n);
    expect(await dao.status()).to.equal(0n);
    expect(await dao.getMembers()).to.deep.equal([
      creator.address,
      memberA.address,
      memberB.address,
    ]);
    expect(await dao.isMember(creator.address)).to.equal(true);
  });

  it('indexes created DAOs by every member address', async () => {
    const { creator, memberA, memberB, outsider, factory } = await deployFactory();

    const firstDaoAddress = await factory.createDAO.staticCall('First DAO', [memberA.address], 0);
    await factory.createDAO('First DAO', [memberA.address], 0);

    const secondDaoAddress = await factory.createDAO.staticCall(
      'Second DAO',
      [memberA.address, memberB.address],
      1,
    );
    await factory.createDAO('Second DAO', [memberA.address, memberB.address], 1);

    expect(await factory.getDAOsByMember(creator.address)).to.deep.equal([
      firstDaoAddress,
      secondDaoAddress,
    ]);
    expect(await factory.getDAOsByMember(memberA.address)).to.deep.equal([
      firstDaoAddress,
      secondDaoAddress,
    ]);
    expect(await factory.getDAOsByMember(memberB.address)).to.deep.equal([secondDaoAddress]);
    expect(await factory.getDAOsByMember(outsider.address)).to.deep.equal([]);
    expect(await factory.getAllDAOs()).to.deep.equal([firstDaoAddress, secondDaoAddress]);
  });

  it('allows one address to belong to multiple DAOs without corrupting factory state', async () => {
    const { memberA, factory } = await deployFactory();

    for (const name of ['Treasury One', 'Treasury Two', 'Treasury Three']) {
      await factory.createDAO(name, [memberA.address], 0);
    }

    const memberDaos = await factory.getDAOsByMember(memberA.address);
    const allDaos = await factory.getAllDAOs();

    expect(memberDaos).to.have.lengthOf(3);
    expect(memberDaos).to.deep.equal(allDaos);
  });

  it('reverts when an additional member duplicates the creator', async () => {
    const { creator, factory, vaultFactory } = await deployFactory();

    await expect(factory.createDAO('Duplicate Creator', [creator.address], 0))
      .to.be.revertedWithCustomError(vaultFactory, 'DuplicateMember')
      .withArgs(creator.address);
  });

  it('reverts when additional members contain a duplicate address', async () => {
    const { memberA, factory, vaultFactory } = await deployFactory();

    await expect(factory.createDAO('Duplicate Member', [memberA.address, memberA.address], 0))
      .to.be.revertedWithCustomError(vaultFactory, 'DuplicateMember')
      .withArgs(memberA.address);
  });

  it('reverts when total member count exceeds the MVP maximum of 20', async () => {
    const { factory, vaultFactory } = await deployFactory();
    const additionalMembers = Array.from(
      { length: 20 },
      () => ethers.Wallet.createRandom().address,
    );

    await expect(
      factory.createDAO('Too Many Members', additionalMembers, 0),
    ).to.be.revertedWithCustomError(vaultFactory, 'TooManyMembers');
  });

  it('accepts exactly 20 total members', async () => {
    const { factory } = await deployFactory();
    const additionalMembers = Array.from(
      { length: 19 },
      () => ethers.Wallet.createRandom().address,
    );
    const daoAddress = await factory.createDAO.staticCall('Max Members', additionalMembers, 1);

    await factory.createDAO('Max Members', additionalMembers, 1);

    const dao = await ethers.getContractAt('DAOVault', daoAddress);
    expect(await dao.memberCount()).to.equal(20n);
    expect(await dao.approvalRule()).to.equal(1n);
  });

  it('reverts invalid approval rules, empty names, and zero member addresses', async () => {
    const { memberA, factory, vaultFactory } = await deployFactory();

    await expect(
      factory.createDAO('Invalid Rule', [memberA.address], 2),
    ).to.be.revertedWithCustomError(vaultFactory, 'InvalidApprovalRule');
    await expect(factory.createDAO('', [memberA.address], 0)).to.be.revertedWithCustomError(
      vaultFactory,
      'EmptyName',
    );
    await expect(
      factory.createDAO('Zero Address', [ethers.ZeroAddress], 0),
    ).to.be.revertedWithCustomError(vaultFactory, 'InvalidMember');
  });
});
