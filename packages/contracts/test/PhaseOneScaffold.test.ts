import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('PhaseOneScaffold', () => {
  it('exposes the Sepolia chain id constant', async () => {
    const scaffold = await ethers.deployContract('PhaseOneScaffold');

    expect(await scaffold.SEPOLIA_CHAIN_ID()).to.equal(11155111n);
  });
});
