import {ethers} from "hardhat";
import {ContractReader, Controller, IStrategy, VaultController} from "../../../../typechain";
import {writeFileSync} from "fs";
import {DeployerUtils} from "../../DeployerUtils";
import {MaticAddresses} from "../../../../test/MaticAddresses";

async function main() {
  const signer = (await ethers.getSigners())[0];
  const core = await DeployerUtils.getCoreAddresses();
  const tools = await DeployerUtils.getToolsAddresses();

  const controller = await DeployerUtils.connectContract(signer, "Controller", core.controller) as Controller;
  const vaultController = await DeployerUtils.connectContract(signer, "VaultController", core.vaultController) as VaultController;

  const vaultNames = new Set<string>();

  const cReader = await DeployerUtils.connectContract(
      signer, "ContractReader", tools.reader) as ContractReader;

  const deployedVaultAddresses = await cReader.vaults();
  console.log('all vaults size', deployedVaultAddresses.length);

  for (let vAdr of deployedVaultAddresses) {
    console.log(vAdr);
    vaultNames.add(await cReader.vaultName(vAdr));
  }

  const vaultNameWithoutPrefix = `CURVE_REN`;

  if (vaultNames.has('TETU_' + vaultNameWithoutPrefix)) {
    console.log('Strategy already exist', vaultNameWithoutPrefix);
  }

  let [vaultLogic, vault, strategy] = await DeployerUtils.deployVaultAndStrategy(
      vaultNameWithoutPrefix,
      vaultAddress => DeployerUtils.deployContract(
          signer,
          'CurveAaveStrategy',
          core.controller,
          MaticAddresses.BTCCRV_TOKEN,
          vaultAddress
      ) as Promise<IStrategy>,
      controller,
      vaultController,
      core.psVault,
      signer,
      60 * 60 * 24 * 28,
      true
  );

  if ((await ethers.provider.getNetwork()).name !== "hardhat") {
    await DeployerUtils.wait(5);
    await DeployerUtils.verify(vaultLogic.address);
    await DeployerUtils.verifyWithArgs(vault.address, [vaultLogic.address]);
    await DeployerUtils.verifyProxy(vault.address);
    await DeployerUtils.verifyWithContractName(strategy.address, 'contracts/strategies/matic/curve/CurveRenStrategy.sol:CurveRenStrategy', [
      core.controller,
      MaticAddresses.BTCCRV_TOKEN,
      vault.address
    ]);
  }

  await writeFileSync(`./tmp/${vaultNameWithoutPrefix}.txt`,
      JSON.stringify([vaultLogic, vault, strategy]), 'utf8');

}

main()
.then(() => process.exit(0))
.catch(error => {
  console.error(error);
  process.exit(1);
});
