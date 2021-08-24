import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { MaticAddresses } from "../../../MaticAddresses";
import { Settings } from "../../../../settings";
import { UniswapUtils } from "../../../UniswapUtils";
import { utils} from "ethers";
import { ethers} from "hardhat";
import { Erc20Utils } from "../../../Erc20Utils";
import { StrategyInfo } from "../../StrategyInfo";
import { TimeUtils } from "../../../TimeUtils";
import { DeployerUtils } from "../../../../scripts/deploy/DeployerUtils";
import { StrategyTestUtils } from "../../StrategyTestUtils";
import { addLiquidityRen, configureFeeRewardForwarder} from "./utils/CurveUtils";
import { DoHardWorkLoop } from "../../DoHardWorkLoop";
import { CurveDoHardWorkLoop } from "./utils/CurveDoHardWorkLoop";

chai.use(chaiAsPromised);

describe('Curve ren tests', async () => {
    if (Settings.disableStrategyTests) {
        return;
    }
    let snapshotBefore: string;
    let snapshot: string;
    let strategyInfo: StrategyInfo;

    before(async function () {
        snapshotBefore = await TimeUtils.snapshot();
        const [signer, investor, trader] = (await ethers.getSigners());
        const coreContracts = await DeployerUtils.deployAllCoreContracts(signer, 60 * 60 * 24 * 28, 1);
        const calculator = (await DeployerUtils.deployPriceCalculatorMatic(signer, coreContracts.controller.address))[0];
        
        const underlying = MaticAddresses.BTCCRV_TOKEN;
        
        const underlyingName = await Erc20Utils.tokenSymbol(underlying);

        const strategyName = 'CurveRenStrategyFullBuyback';

        await configureFeeRewardForwarder(coreContracts.feeRewardForwarder, coreContracts.rewardToken);

        const [vault, strategy, lpForTargetToken] = await StrategyTestUtils.deployStrategy(
            strategyName, signer, coreContracts, underlying, underlyingName);
  
        strategyInfo = new StrategyInfo(
            underlying,
            signer,
            investor,
            coreContracts,
            vault,
            strategy,
            lpForTargetToken,
            calculator
        );
  
        // swap tokens to invest      
        await UniswapUtils.buyToken(trader, MaticAddresses.SUSHI_ROUTER, MaticAddresses.WMATIC_TOKEN, utils.parseUnits('1000000')); // 100m wmatic
        await UniswapUtils.buyToken(trader, MaticAddresses.SUSHI_ROUTER, MaticAddresses.USDC_TOKEN, utils.parseUnits('1000000'));

        await addLiquidityRen(investor);

        console.log('############## Preparations completed ##################');
      });
  
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
  
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });
  
      after(async function () {
        await TimeUtils.rollback(snapshotBefore);
      });

      it("do hard work with liq path", async () => {
        await CurveDoHardWorkLoop.doHardWorkWithLiqPath(strategyInfo, MaticAddresses.CURVE_renBTC_GAGUE);
      });

      it("doHardWork loop", async function () {
        await DoHardWorkLoop.doHardWorkLoop(
            strategyInfo,
            (await Erc20Utils.balanceOf(strategyInfo.underlying, strategyInfo.user.address)).toString(),
            3,
            27000
        );
      });

      it("emergency exit", async () => {
        await StrategyTestUtils.checkEmergencyExit(strategyInfo);
      });
      
      it("common test should be ok", async () => {
        await StrategyTestUtils.commonTests(strategyInfo);
      });



});