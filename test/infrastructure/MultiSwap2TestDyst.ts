import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  MultiSwap2,
} from "../../typechain";
import {ethers, network, config} from "hardhat";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../scripts/deploy/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

import {TokenUtils} from "../TokenUtils";
import {BigNumber, BigNumberish} from "ethers";
import {MaxUint256} from '@ethersproject/constants';


import testJson from './json/MultiSwap2TestDataDyst.json';
import {CoreAddresses} from "../../scripts/models/CoreAddresses";
import {TimeUtils} from "../TimeUtils";
import {_SLIPPAGE_DENOMINATOR, ITestData} from "./MultiSwap2Interfaces";


// const {expect} = chai;
chai.use(chaiAsPromised);


describe("MultiSwap2 Dystopia main pairs test", function () {
  let signer: SignerWithAddress;
  let core: CoreAddresses;
  let multiSwap2: MultiSwap2;
  let usdc: string;
  let snapshotForEach: string;

  const testData = testJson.testData as unknown as ITestData;

  before(async function () {
    this.timeout(1200000);

    // start hardhat fork from the block number test data generated for
    const blockNumber = testJson.blockNumber;
    console.log('Resetting hardhat fork to block Number', blockNumber);
    await TimeUtils.resetBlockNumber(config.networks.hardhat.forking?.url, blockNumber);

    const latestBlock = await ethers.provider.getBlock('latest');
    console.log('latestBlock', latestBlock.number);


    signer = (await ethers.getSigners())[0];
    core = await DeployerUtils.getCoreAddresses();

    usdc = await DeployerUtils.getUSDCAddress();

    if (network.name === 'hardhat') {

      const networkToken = await DeployerUtils.getNetworkTokenAddress();
      multiSwap2 = await DeployerUtils.deployContract(
          signer,
          'MultiSwap2',
          core.controller,
          networkToken,
          MaticAddresses.BALANCER_VAULT,
          MaticAddresses.TETU_SWAP_FACTORY,
      ) as MultiSwap2;

    } else console.error('Unsupported network', network.name)

  })

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });

  it("do Dystopia-urgent multi swaps", async () => {
    const deadline = MaxUint256;
    const slippageTolerance = _SLIPPAGE_DENOMINATOR * 0.5 / 100; // 0.5%
    let total = 0
    let reverted = 0;

    // for (const key of Object.keys(testData).slice(0)) {
    for (const key of Object.keys(testData)) {
      console.log('\n-----------------------');
      console.log(total++, key);
      console.log('-----------------------');
      const snapshot = await TimeUtils.snapshot();

      const multiswap = testData[key];

      const tokenIn = multiswap.swapData.tokenIn;
      const tokenOut = multiswap.swapData.tokenOut;

      const amount = BigNumber.from(multiswap.swapAmount);
      const getAmount = amount.mul(2); // to support fee on transfer tokens
      await TokenUtils.getToken(tokenIn, signer.address, getAmount);
      const receivedAmount = await TokenUtils.balanceOf(tokenIn, signer.address);

      await TokenUtils.approve(tokenIn, signer, multiSwap2.address, getAmount.toString());
      const amountOutBefore = await TokenUtils.balanceOf(tokenOut, signer.address);

      try {
        await multiSwap2.multiSwap(
            multiswap.swapData,
            multiswap.swaps,
            multiswap.tokenAddresses,
            slippageTolerance,
            deadline
        );

        const amountOutAfter = await TokenUtils.balanceOf(tokenOut, signer.address);

        const amountOut = amountOutAfter.sub(amountOutBefore);
        console.log('___');
        console.log('amountOut     ', amountOut.toString());
        const amountExpected = multiswap.returnAmount;
        console.log('amountExpected', amountExpected);
        const diff = BigNumber.from(amountOut).mul(1000000).div(amountExpected).toNumber() / 10000 - 100;
        console.log('diff', diff.toFixed(4), '%  ');

        // expect(diff).lt(0.1); // TODO remove comment

      } catch (e) {
        reverted++;
        console.warn('Swap reverted:', e);
      }

      await TimeUtils.rollback(snapshot);

    }
    console.log('total   ', total);
    console.log('reverted', reverted);
    expect(reverted).eq(0);

  })

})
