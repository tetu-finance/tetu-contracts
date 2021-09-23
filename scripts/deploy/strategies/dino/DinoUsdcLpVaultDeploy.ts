import {McLpStrategyDeployer} from "../McLpStrategyDeployer";
import {MaticAddresses} from "../../../../test/MaticAddresses";

async function main() {
  await McLpStrategyDeployer.deploy(
      MaticAddresses.DINO_DINO_USDC,
      10,
      'DINO',
      'StrategyDinoSwapLp',
      'contracts/strategies/matic/dino/StrategyDinoSwapLp.sol:StrategyDinoSwapLp'
  );
}

main()
.then(() => process.exit(0))
.catch(error => {
  console.error(error);
  process.exit(1);
});
