import { ethers } from 'hardhat';

async function main() {
  const factory = await ethers.deployContract('DAOFactory');
  await factory.waitForDeployment();

  const address = await factory.getAddress();
  console.log(`DAOFactory deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
