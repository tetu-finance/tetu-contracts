import { ethers } from 'hardhat';
import {BigNumber, Contract, utils} from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {CompleteRToken, IERC20, IVault, MockAssetManagedPool, MockRewardsAssetManager} from "../../../../typechain";
import {BytesLike} from "@ethersproject/bytes";
import {DeployerUtils} from "../../../../scripts/deploy/DeployerUtils";
import {MaticAddresses} from "../../../MaticAddresses";
import {UniswapUtils} from "../../../UniswapUtils";
import {Erc20Utils} from "../../../Erc20Utils";
import {bn, fp} from "./helpers/numbers";
import {encodeInvestmentConfig} from "./helpers/rebalance";
import {encodeJoin} from "./helpers/mockPool";
import {MAX_UINT256} from "./helpers/constants";
import {TimeUtils} from "../../../TimeUtils";

// import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
//
// import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
// import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
// import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
//
// import { deploy } from '@balancer-labs/v2-helpers/src/contract';
// import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
// import { advanceTime } from '@balancer-labs/v2-helpers/src/time';

const tokenInitialBalance = bn(200e18);

// let vault: IVault;
// let assetManager: MockRewardsAssetManager;
// let otherUser: SignerWithAddress;

enum PoolSpecialization {
  GeneralPool = 0,
  MinimalSwapInfoPool,
  TwoTokenPool,
}

const setup = async () => {
  const [signer, investor, other] = (await ethers.getSigners());

  // Connect to balancer vault
  let vault = await ethers.getContractAt(
      "IVault", "0xBA12222222228d8Ba445958a75a0704d566BF2C8") as IVault;

  // Connect to Iron lending pool
  //???

  // Deploy Pool
  let pool = await DeployerUtils.deployContract(
      signer, "MockAssetManagedPool", vault.address, PoolSpecialization.GeneralPool) as MockAssetManagedPool;
  let poolId = await pool.getPoolId();

  // Deploy Asset manager
  let assetManager = await DeployerUtils.deployContract(signer,
      'IronRTokenAssetManager', vault.address, poolId, MaticAddresses.USDC_TOKEN, MaticAddresses.IRON_RUSDC) as MockRewardsAssetManager;

  // Assign assetManager to the USDC_TOKEN token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  let tokensAddresses = [MaticAddresses.USDC_TOKEN, MaticAddresses.WMATIC_TOKEN]

  await pool.registerTokens(tokensAddresses, assetManagers);

  const config = {
    targetPercentage: fp(0.45),
    upperCriticalPercentage: fp(0.6),
    lowerCriticalPercentage: fp(0.4),
  };

  await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(config));

  // swap tokens to invest
  await UniswapUtils.buyToken(investor, MaticAddresses.SUSHI_ROUTER, MaticAddresses.WMATIC_TOKEN, utils.parseUnits('10000000000')); // 100m wmatic
  await UniswapUtils.buyToken(investor, MaticAddresses.SUSHI_ROUTER, MaticAddresses.USDC_TOKEN, utils.parseUnits('10000'));


  const usdcToken = await ethers.getContractAt("IERC20", MaticAddresses.USDC_TOKEN, investor) as IERC20;
  await usdcToken.approve(vault.address, tokenInitialBalance, {from: investor.address});
  let usdcBal = await usdcToken.balanceOf(investor.address);
  const usdcDec = await Erc20Utils.decimals(usdcToken.address);
  const usdcTokenBal = +utils.formatUnits(usdcBal, usdcDec);
  console.log("usdcToken bal :", usdcTokenBal);

  const wmaticToken = await ethers.getContractAt("IERC20", MaticAddresses.WMATIC_TOKEN, investor) as IERC20;
  await wmaticToken.approve(vault.address, tokenInitialBalance, {from: investor.address});
  let wmaticBal = await wmaticToken.balanceOf(investor.address);
  const wmaticDec = await Erc20Utils.decimals(wmaticToken.address);
  const oppositeTokenBal2 = +utils.formatUnits(wmaticBal, wmaticDec);
  console.log("wmatic bal :", oppositeTokenBal2);



  vault = await ethers.getContractAt(
      "IVault", "0xBA12222222228d8Ba445958a75a0704d566BF2C8", investor) as IVault;

  let ud = encodeJoin(
      tokensAddresses.map(() => BigNumber.from(10000000000)),
      tokensAddresses.map(() => 0)
  );

  await vault.joinPool(poolId, investor.address, investor.address, {
    assets: tokensAddresses,
    maxAmountsIn: tokensAddresses.map(() => MAX_UINT256),
    fromInternalBalance: false,
    userData: ud,
  });

  console.log('############## Preparations completed ##################');


  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      pool,
      vault,
    },
  };
};

describe('Iron Asset manager', function () {
  let vault: Contract, assetManager: Contract, pool: Contract;
  let poolId: BytesLike;
  let investor: SignerWithAddress, other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, investor, other] = await ethers.getSigners();
  });

  beforeEach('set up asset manager', async () => {
    const { contracts, data } = await setup();

    assetManager = contracts.assetManager;
    vault = contracts.vault;
    pool = contracts.pool;
    poolId = data.poolId;
  });

  describe('claimRewards', () => {


    it('AM should use assets in the Iron lending protocol and earn Ice rewards', async () => {
      await assetManager.rebalance(poolId, false);
      const iceToken = await ethers.getContractAt("IERC20", MaticAddresses.ICE_TOKEN, investor) as IERC20;

      const sevenDays = 7 * 24 * 60 * 60;
      await TimeUtils.advanceBlocksOnTs(sevenDays);

      await assetManager.claimRewards();

      // need to be updated to FeeForvarder?
      let iceEarned = await iceToken.balanceOf(assetManager.address);

      console.log("Ice token earned: ", iceEarned.toString());
      expect(iceEarned).to.be.gt(0, "We should earn rewards from lending protocol")

    });

  });
});
