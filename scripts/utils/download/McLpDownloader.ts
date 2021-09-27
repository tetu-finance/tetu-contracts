import {ethers, web3} from "hardhat";
import {DeployerUtils} from "../../deploy/DeployerUtils";
import {
  ERC20,
  IUniswapV2Pair,
  IWaultSwapPair,
  PriceCalculator,
  SmartVault
} from "../../../typechain";
import axios from "axios";
import {VaultUtils} from "../../../test/VaultUtils";
import {BigNumber, utils} from "ethers";
import {Erc20Utils} from "../../../test/Erc20Utils";
import {mkdir, writeFileSync} from "fs";

export class McLpDownloader {


  public static async download(
      platformId: string,
      prefix: string,
      chefAddress: string,
      rewardAddress: string,
      poolLengthCall: () => Promise<BigNumber>,
      rewardPerBlocCall: () => Promise<BigNumber>,
      totalAllocPointCall: () => Promise<BigNumber>,
      poolInfoCall: (id: number) => Promise<{
        "lpAddress": string,
        "allocPoint": BigNumber,
        "lastUpdateTime": number,
        "depositFeeBP"?: number
      }>
  ) {
    const signer = (await ethers.getSigners())[0];
    const core = await DeployerUtils.getCoreAddresses();
    const tools = await DeployerUtils.getToolsAddresses();

    const priceCalculator = await DeployerUtils.connectInterface(signer, 'PriceCalculator', tools.calculator) as PriceCalculator;

    const vaultInfos = await VaultUtils.getVaultInfoFromServer();
    const underlyingStatuses = new Map<string, boolean>();
    const currentRewards = new Map<string, number>();
    const underlyingToVault = new Map<string, string>();
    for (let vInfo of vaultInfos) {
      if(vInfo.platform !== platformId) {
        continue;
      }
      underlyingStatuses.set(vInfo.underlying.toLowerCase(), vInfo.active);
      underlyingToVault.set(vInfo.underlying.toLowerCase(), vInfo.addr);
      if (vInfo.active) {
        console.log(vInfo.addr);
        const vctr = await DeployerUtils.connectInterface(signer, 'SmartVault', vInfo.addr) as SmartVault;
        const rewards = await VaultUtils.vaultRewardsAmount(vctr, core.psVault);
        console.log('rewards', rewards);
        currentRewards.set(vInfo.underlying.toLowerCase(), rewards);
      }
    }

    const poolLength = (await poolLengthCall()).toNumber();
    console.log('length', poolLength);

    const rewardPerBlock = await rewardPerBlocCall();
    const totalAllocPoint = await totalAllocPointCall();
    const rewardPrice = await priceCalculator.getPriceWithDefaultOutput(rewardAddress);
    console.log('reward price', utils.formatUnits(rewardPrice));

    let infos: string = 'idx, lp_name, lp_address, token0, token0_name, token1, token1_name, alloc, weekRewardUsd, tvlUsd, apr, currentRewards, vault \n';
    let counter = 0;
    for (let i = 0; i < poolLength; i++) {
      try {
        const poolInfo = await poolInfoCall(i);
        if (poolInfo.depositFeeBP) {
          console.log('depositFeeBP', poolInfo.depositFeeBP, 'is defined, skipping the pool');
          continue;
        }
        const lp = poolInfo.lpAddress;
        const status = underlyingStatuses.get(lp.toLowerCase());
        if (status != null && !status) {
          console.log('deactivated');
          continue;
        }
        const lpContract = await DeployerUtils.connectInterface(signer, 'IUniswapV2Pair', lp) as IUniswapV2Pair

        const allocPoint = poolInfo.allocPoint;
        const currentBlock = await web3.eth.getBlockNumber();
        const duration = currentBlock - poolInfo.lastUpdateTime;
        console.log('duration', duration, currentBlock, poolInfo.lastUpdateTime);
        const weekRewardUsd = McLpDownloader.computeWeekReward(duration, rewardPerBlock, allocPoint, totalAllocPoint, rewardPrice);
        console.log('weekRewardUsd', weekRewardUsd);

        const lpPrice = await priceCalculator.getPriceWithDefaultOutput(lp);
        const tvl = await lpContract.balanceOf(chefAddress);
        const tvlUsd = utils.formatUnits(tvl.mul(lpPrice).div(1e9).div(1e9));

        const apr = ((weekRewardUsd / +tvlUsd) / 7) * 365 * 100;

        let token0: string = '';
        let token1: string = '';
        let token0Name: string = '';
        let token1Name: string = '';

        try {
          const lpContract = await DeployerUtils.connectInterface(signer, 'IWaultSwapPair', lp) as IWaultSwapPair;
          token0 = await lpContract.token0();
          token1 = await lpContract.token1();
          token0Name = await Erc20Utils.tokenSymbol(token0);
          token1Name = await Erc20Utils.tokenSymbol(token1);
        } catch (e) {
        }

        if (token0 === '') {
          const token = await DeployerUtils.connectInterface(signer, 'ERC20', lp) as ERC20;
          token0Name = await token.symbol();
        }

        const data = i + ',' +
            prefix + '_' + token0Name + (token1Name ? '_' + token1Name : '') + ',' +
            lp + ',' +
            token0 + ',' +
            token0Name + ',' +
            token1 + ',' +
            token1Name + ',' +
            poolInfo.allocPoint + ',' +
            weekRewardUsd.toFixed() + ',' +
            (+tvlUsd).toFixed() + ',' +
            apr.toFixed(0) + ',' +
            currentRewards.get(lp.toLowerCase()) + ',' +
            underlyingToVault.get(lp.toLowerCase())
        ;
        console.log(data);
        infos += data + '\n';
        counter++;
      } catch (e) {
        console.error('Error download pool', i);
      }
    }

    mkdir('./tmp', {recursive: true}, (err) => {
      if (err) throw err;
    });

    await writeFileSync(`./tmp/${prefix.toLowerCase()}_pools.csv`, infos, 'utf8');
    console.log('downloaded', prefix, counter);
  }

  public static computeWeekReward(
      blockDuration: number,
      tokenPerBlock: BigNumber,
      allocPoint: BigNumber,
      totalAllocPoint: BigNumber,
      tokenPrice: BigNumber,
      averageBlockTime = 5
  ): number {
    console.log('blockDuration', blockDuration,
        'tokenPerBlock', tokenPerBlock.toString(),
        'allocPoint', allocPoint.toString(),
        'totalAllocPoint', totalAllocPoint.toString(),
        'tokenPrice', tokenPrice.toString(),
        'averageBlockTime', averageBlockTime);
    const reward = BigNumber.from(blockDuration).mul(tokenPerBlock).mul(allocPoint).div(totalAllocPoint);
    const timeWeekRate = (60 * 60 * 24 * 7) / (blockDuration * averageBlockTime);
    const rewardForWeek = +utils.formatUnits(reward) * timeWeekRate;
    return +utils.formatUnits(tokenPrice) * rewardForWeek;
  }

}

