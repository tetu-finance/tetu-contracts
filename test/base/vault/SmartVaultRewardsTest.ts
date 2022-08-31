import {ethers} from "hardhat";
import chai from "chai";
import {
  ContractReader,
  DepositHelper,
  Multicall,
  MultiSwap,
  NoopStrategy,
  ZapContract
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/deploy/DeployerUtils";
import {VaultUtils} from "../../VaultUtils";
import {BigNumber, utils} from "ethers";
import {TokenUtils} from "../../TokenUtils";
import {TimeUtils} from "../../TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import chaiAsPromised from "chai-as-promised";
import {CoreContractsWrapper} from "../../CoreContractsWrapper";
import {UniswapUtils} from "../../UniswapUtils";
import {ZapUtils} from "../../ZapUtils";
import {Misc} from "../../../scripts/utils/tools/Misc";
import {MintHelperUtils} from "../../MintHelperUtils";
import { parseUnits } from "ethers/lib/utils";

const {expect} = chai;
chai.use(chaiAsPromised);

describe("Smart vault rewards test", () => {
  const MAX_UINT = BigNumber.from(2).pow(256).sub(1).toString();

  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
  let core: CoreContractsWrapper;
  let contractReader: ContractReader;
  let zapContract: ZapContract;
  let multiSwap: MultiSwap;
  let multicall: Multicall;
  let depositHelper: DepositHelper;
  let usdc: string;
  let networkToken: string;
  let factory: string;
  let router: string;

  before(async function () {
    signer = await DeployerUtils.impersonate();
    core = await DeployerUtils.deployAllCoreContracts(signer);
    snapshot = await TimeUtils.snapshot();

    usdc = (await DeployerUtils.deployMockToken(signer, 'USDC', 6)).address.toLowerCase();
    networkToken = (await DeployerUtils.deployMockToken(signer, 'WETH')).address.toLowerCase();

    const uniData = await UniswapUtils.deployUniswap(signer);
    factory = uniData.factory.address;
    router = uniData.router.address;

    const calculator = (await DeployerUtils.deployPriceCalculatorTestnet(signer, core.controller.address, usdc, factory))[0];

    multicall = await DeployerUtils.deployContract(signer, "Multicall") as Multicall;
    depositHelper = await DeployerUtils.deployContract(signer, "DepositHelper") as DepositHelper;
    await core.controller.changeWhiteListStatus([depositHelper.address], true);

    const crLogic = await DeployerUtils.deployContract(signer, "ContractReader");
    const crProxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", crLogic.address);
    contractReader = crLogic.attach(crProxy.address) as ContractReader;

    await contractReader.initialize(core.controller.address, calculator.address);

    multiSwap = await DeployerUtils.deployMultiSwapTestnet(signer, core.controller.address, calculator.address, factory, router);
    zapContract = (await DeployerUtils.deployZapContract(signer, core.controller.address, multiSwap.address));
    await core.controller.changeWhiteListStatus([zapContract.address], true);

    await UniswapUtils.addLiquidity(
      signer,
      usdc,
      networkToken,
      parseUnits('100000', 6).toString(),
      parseUnits('100000').toString(),
      uniData.factory.address,
      uniData.router.address,
    );
    await calculator.addKeyToken(networkToken);

  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });


  it("check reward vesting for multiple accounts with MATIC rewards and LP underlying", async () => {
    const underlying = await UniswapUtils.addLiquidity(
      signer,
      networkToken,
      usdc,
      utils.parseUnits('10000').toString(),
      utils.parseUnits('10000', 6).toString(),
      factory,
      router,
    );

    const rt = networkToken;

    // ******** DEPLOY VAULT *******
    const vault = await DeployerUtils.deploySmartVault(signer);
    const strategy = await DeployerUtils.deployContract(signer, "NoopStrategy",
      core.controller.address, underlying, vault.address, [Misc.ZERO_ADDRESS], [networkToken, usdc], 1) as NoopStrategy;
    await vault.initializeSmartVault(
      "NOOP",
      "tNOOP",
      core.controller.address,
      underlying,
      60 * 60 * 24 * 28,
      false,
      Misc.ZERO_ADDRESS,
      0
    );
    await core.controller.addVaultsAndStrategies([vault.address], [strategy.address]);
    await core.vaultController.addRewardTokens([vault.address], rt);

    // ********** INIT VARS **************
    const user1 = (await ethers.getSigners())[1];
    const user2 = (await ethers.getSigners())[2];
    const user3 = (await ethers.getSigners())[3];
    const user4 = (await ethers.getSigners())[4];
    const user5 = (await ethers.getSigners())[5];
    const user6 = (await ethers.getSigners())[6]; // DepositHelper deposit / getAllRewards tests
    const user7 = (await ethers.getSigners())[7]; // DepositHelper deposit / withdraw (with rewards) tests
    const rtDecimals = await TokenUtils.decimals(rt);
    const underlyingDec = await TokenUtils.decimals(underlying);
    const duration = (await vault.duration()).toNumber();
    const time = 60 * 60 * 24 * 7;
    let rewardsTotalAmount = utils.parseUnits('10', rtDecimals);

    console.log('underlying amount', utils.formatUnits(await TokenUtils.balanceOf(underlying, signer.address), underlyingDec));

    await TokenUtils.getToken(rt, signer.address, utils.parseUnits('300'));
    await TokenUtils.approve(rt, signer, vault.address, rewardsTotalAmount.toString());
    await vault.notifyTargetRewardAmount(rt, rewardsTotalAmount);


    const signerUndBal = +utils.formatUnits(await TokenUtils.balanceOf(underlying, signer.address), underlyingDec);
    // const signerDeposit = (signerUndBal * 0.1).toFixed(underlyingDec);
    const user1Deposit = (signerUndBal * 0.2).toFixed(underlyingDec);
    // const user2Deposit = (signerUndBal * 0.3).toFixed(underlyingDec);
    const user3Deposit = (signerUndBal * 0.15).toFixed(underlyingDec);
    const user4Deposit = (signerUndBal * 0.05).toFixed(underlyingDec);
    const user5Deposit = (signerUndBal * 0.09).toFixed(underlyingDec);
    const user6Deposit = (signerUndBal * 0.06).toFixed(underlyingDec);
    const user7Deposit = (signerUndBal * 0.07).toFixed(underlyingDec);


    await TokenUtils.transfer(underlying, signer, user1.address, utils.parseUnits(user1Deposit, underlyingDec).toString());
    await TokenUtils.transfer(networkToken, signer, user2.address, utils.parseUnits('10000').toString());
    // await Erc20Utils.transfer(underlying, signer, user2.address, utils.parseUnits(user2Deposit, underlyingDec).toString());
    await TokenUtils.transfer(underlying, signer, user3.address, utils.parseUnits(user3Deposit, underlyingDec).toString());
    await TokenUtils.transfer(underlying, signer, user4.address, utils.parseUnits(user4Deposit, underlyingDec).toString());
    await TokenUtils.transfer(underlying, signer, user5.address, utils.parseUnits(user5Deposit, underlyingDec).toString());
    await TokenUtils.transfer(underlying, signer, user6.address, utils.parseUnits(user6Deposit, underlyingDec).toString());
    await TokenUtils.transfer(underlying, signer, user7.address, utils.parseUnits(user7Deposit, underlyingDec).toString());

    // long holder
    await VaultUtils.deposit(user3, vault, utils.parseUnits(user3Deposit, underlyingDec));
    await VaultUtils.deposit(user4, vault, utils.parseUnits(user4Deposit, underlyingDec));
    await VaultUtils.deposit(user5, vault, utils.parseUnits(user5Deposit, underlyingDec));

    // deposit helper
    const depositAmount6 = utils.parseUnits(user6Deposit, underlyingDec);
    await TokenUtils.approve(underlying, user6, depositHelper.address, depositAmount6.toString());
    await depositHelper.connect(user6).depositToVault(vault.address, depositAmount6);

    const depositAmount7 = utils.parseUnits(user7Deposit, underlyingDec);
    await TokenUtils.approve(underlying, user7, depositHelper.address, depositAmount7.toString());
    await depositHelper.connect(user7).depositToVault(vault.address, depositAmount7);

    const signerUndBal2 = +utils.formatUnits(await TokenUtils.balanceOf(underlying, signer.address), underlyingDec);

    // *************** CYCLES *************
    let claimedTotal = 0;
    const cyclesBase = +(duration / (time + 3)).toFixed(0);
    const cycles = cyclesBase * 2;
    const undSendPart = ((signerUndBal2 / cycles) * 0.99).toFixed(underlyingDec);
    console.log('cycles', cycles);
    let user1Deposited = false;
    let user2Deposited = false;

    let finish = (await vault.periodFinishForToken(rt)).toNumber();

    for (let i = 0; i < cycles; i++) {
      console.log('cycle', i, cycles);
      const ppfs = +utils.formatUnits(await vault.getPricePerFullShare(), underlyingDec);

      if (i === 50) {
        console.log("!!!!!!!!!!add rewards", finish)
        await TokenUtils.approve(rt, signer, vault.address, rewardsTotalAmount.toString());
        await vault.notifyTargetRewardAmount(rt, rewardsTotalAmount);
        rewardsTotalAmount = rewardsTotalAmount.mul(2);
        finish = (await vault.periodFinishForToken(rt)).toNumber();
        console.log("!!!!!!!!!!end add rewards", finish)
      }

      if (i % 3 === 0) {
        if (user1Deposited) {
          await vault.connect(user1).exit();
          user1Deposited = false;
        } else {
          await VaultUtils.deposit(user1, vault, utils.parseUnits(user1Deposit, underlyingDec));
          user1Deposited = true;
        }
      }

      if (i % 5 === 0) {
        if (user2Deposited) {
          const user2Staked = await TokenUtils.balanceOf(vault.address, user2.address);
          await ZapUtils.zapLpOut(
            user2,
            multiSwap,
            zapContract,
            contractReader,
            vault.address,
            networkToken,
            user2Staked.toString(),
            2
          );

          user2Deposited = false;
        } else {
          await ZapUtils.zapLpIn(
            user2,
            multiSwap,
            zapContract,
            contractReader,
            vault.address,
            networkToken,
            1000,
            2
          );

          user2Deposited = true;
        }
      }

      // ! TIME MACHINE BRRRRRRR
      await TimeUtils.advanceBlocksOnTs(time);

      console.log('vaultApr', await VaultUtils.vaultApr(vault, rt, contractReader),
        utils.formatUnits((await contractReader.vaultRewardsApr(vault.address))[0]));
      console.log('rewardPerToken', utils.formatUnits(await vault.rewardPerToken(rt)));


      const _vaultRtBalance = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address), rtDecimals);

      const rtBalanceUser5 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user5.address), rtDecimals);
      const toClaimUser5 = +utils.formatUnits(await vault.earnedWithBoost(rt, user5.address), rtDecimals);
      const toClaimUser5FullBoost = +utils.formatUnits(await vault.earned(rt, user5.address), rtDecimals);

      const rtBalanceUser6 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user6.address), rtDecimals);
      const toClaimUser6 = +utils.formatUnits(await vault.earnedWithBoost(rt, user6.address), rtDecimals);
      const toClaimUser6FullBoost = +utils.formatUnits(await vault.earned(rt, user6.address), rtDecimals);

      const rtBalanceUser1 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user1.address), rtDecimals);
      const toClaimUser1 = +utils.formatUnits(await vault.earnedWithBoost(rt, user1.address), rtDecimals);
      const toClaimUser1FullBoost = +utils.formatUnits(await vault.earned(rt, user1.address), rtDecimals);

      const rtBalanceUser2 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user2.address), rtDecimals);
      const toClaimUser2 = +utils.formatUnits(await vault.earnedWithBoost(rt, user2.address), rtDecimals);
      const toClaimUser2FullBoost = +utils.formatUnits(await vault.earned(rt, user2.address), rtDecimals);

      const _toClaimUser3FullBoost = +utils.formatUnits(await vault.earned(rt, user3.address), rtDecimals);
      const _toClaimUser3 = +utils.formatUnits(await vault.earnedWithBoost(rt, user3.address), rtDecimals);

      console.log('User6 toClaim', toClaimUser6, 'all rewards in vault', _vaultRtBalance, 'rt balance', rtBalanceUser6, 'full boost', toClaimUser6FullBoost);
      console.log('User5 toClaim', toClaimUser5, 'all rewards in vault', _vaultRtBalance, 'rt balance', rtBalanceUser5, 'full boost', toClaimUser5FullBoost);
      console.log('User1 toClaim', toClaimUser1, 'all rewards in vault', _vaultRtBalance, 'rt balance', rtBalanceUser1, 'full boost', toClaimUser1FullBoost);
      console.log('User2 toClaim', toClaimUser2, 'all rewards in vault', _vaultRtBalance, 'rt balance', rtBalanceUser2, 'full boost', toClaimUser2FullBoost);
      console.log('User3 toClaim', _toClaimUser3, '100% boost', _toClaimUser3FullBoost);

      expect(toClaimUser5).is.greaterThan(0, 'to claim is zero ' + i);
      expect(toClaimUser6).is.greaterThan(0, 'to claim is zero ' + i);
      if (user1Deposited) {
        expect(toClaimUser1).is.greaterThan(0, 'to claim is zero ' + i);
      }
      if (user2Deposited) {
        expect(toClaimUser2).is.greaterThan(0, 'to claim is zero ' + i);
      }


      await vault.connect(user5).getAllRewards();
      const claimedUser5 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user5.address), rtDecimals) - rtBalanceUser5;
      claimedTotal += claimedUser5;
      expect(claimedUser5).is.greaterThan(0);
      expect(toClaimUser5).is.approximately(claimedUser5, claimedUser5 * 0.01, 'user5 claimed not enough ' + i);

      // we have to approve shares for deposit helper to claim (SmartVault checks approval to shares when claiming)
      await TokenUtils.approve(vault.address, user6, depositHelper.address, MAX_UINT);
      await depositHelper.connect(user6).getAllRewards(vault.address);
      const claimedUser6 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user6.address), rtDecimals) - rtBalanceUser6;
      claimedTotal += claimedUser6;
      expect(claimedUser6).is.greaterThan(0);
      expect(toClaimUser6).is.approximately(claimedUser6, claimedUser6 * 0.01, 'user6 claimed not enough ' + i);

      if (user1Deposited) {
        // test claim with exit
        await vault.connect(user1).exit();
        await VaultUtils.deposit(user1, vault, utils.parseUnits(user1Deposit, underlyingDec));
        const claimedUser1 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user1.address), rtDecimals) - rtBalanceUser1;
        claimedTotal += claimedUser1;
        expect(claimedUser1).is.greaterThan(0);
        expect(toClaimUser1).is.approximately(claimedUser1, claimedUser1 * 0.01, 'user1 claimed not enough ' + i);
      }

      if (user2Deposited) {
        await vault.connect(user2).getAllRewards();
        const claimedUser2 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user2.address), rtDecimals) - rtBalanceUser2;
        claimedTotal += claimedUser2;
        expect(claimedUser2).is.greaterThan(0);
        expect(toClaimUser2).is.approximately(claimedUser2, claimedUser2 * 0.01, 'user2 claimed not enough ' + i);
      }

      if (i !== 0 && (i % +((cycles / 2).toFixed()) === 0)) {
        const _rtBalanceUser3 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user3.address), rtDecimals);
        await vault.connect(user3).getAllRewards();
        const _claimedUser3 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user3.address), rtDecimals) - _rtBalanceUser3;
        claimedTotal += _claimedUser3;
        console.log('claimedUser3', _claimedUser3);
        expect(_claimedUser3).is.greaterThan(0);
        expect(_toClaimUser3).is.approximately(_claimedUser3, _claimedUser3 * 0.01, 'user3 claimed not enough ' + i);
      }


      // ppfs change test
      await TokenUtils.transfer(underlying, signer, vault.address, utils.parseUnits(undSendPart, underlyingDec).toString());
      const ppfsAfter = +utils.formatUnits(await vault.getPricePerFullShare(), underlyingDec);
      console.log('ppfs change', ppfsAfter - ppfs)
      console.log('claimedTotal', claimedTotal, +utils.formatUnits(rewardsTotalAmount, rtDecimals));

      if ((await multicall.getCurrentBlockTimestamp()).toNumber() > finish) {
        console.log('cycles ended', i);
        break;
      }

    }
    const toClaimUser3FullBoost = +utils.formatUnits(await vault.earned(rt, user3.address), rtDecimals);
    const toClaimUser3 = +utils.formatUnits(await vault.earnedWithBoost(rt, user3.address), rtDecimals);
    console.log('User3 toClaim', toClaimUser3, '100% boost', toClaimUser3FullBoost);
    const rtBalanceUser3 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user3.address), rtDecimals);
    await vault.connect(user3).getAllRewards();
    const claimedUser3 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user3.address), rtDecimals) - rtBalanceUser3;
    claimedTotal += claimedUser3;
    console.log('claimedUser3', claimedUser3);
    expect(claimedUser3).is.greaterThan(0);
    expect(toClaimUser3).is.approximately(claimedUser3, claimedUser3 * 0.01, 'user3 claimed not enough');

    const toClaimUser4FullBoost = +utils.formatUnits(await vault.earned(rt, user4.address), rtDecimals);
    const toClaimUser4 = +utils.formatUnits(await vault.earnedWithBoost(rt, user4.address), rtDecimals);
    console.log('User4 toClaim', toClaimUser4, '100% boost', toClaimUser4FullBoost);
    const rtBalanceUser4 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user4.address), rtDecimals);
    await vault.connect(user4).getAllRewards();
    const claimedUser4 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user4.address), rtDecimals) - rtBalanceUser4;
    claimedTotal += claimedUser4;
    console.log('claimedUser4', claimedUser4);
    expect(claimedUser4).is.greaterThan(0);
    expect(toClaimUser4).is.approximately(claimedUser4, claimedUser4 * 0.01, 'user4 claimed not enough');

    const rtBalanceUser7 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user7.address), rtDecimals);
    const toClaimUser7 = +utils.formatUnits(await vault.earnedWithBoost(rt, user7.address), rtDecimals);
    const shares = await TokenUtils.balanceOf(vault.address, user7.address);
    // we have to approve shares for deposit helper to claim (SmartVault checks approval to shares when claiming)
    await TokenUtils.approve(vault.address, user7, depositHelper.address, MAX_UINT);
    await depositHelper.connect(user7).withdrawFromVault(vault.address, shares);
    const claimedUser7 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user7.address), rtDecimals) - rtBalanceUser7;
    claimedTotal += claimedUser7;
    expect(claimedUser7).is.greaterThan(0);
    expect(toClaimUser7).is.approximately(claimedUser7, claimedUser7 * 0.01, 'user7 (used DepositHelper) claimed not enough ');


    const vaultRtBalance = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address), rtDecimals);
    console.log('vaultRtBalance', vaultRtBalance);
    const controllerBal = +utils.formatUnits(await TokenUtils.balanceOf(rt, core.controller.address), rtDecimals);
    console.log('controller bal', controllerBal);

    console.log('claimedTotal with contr', claimedTotal + controllerBal, +utils.formatUnits(rewardsTotalAmount, rtDecimals));

    expect(claimedTotal + controllerBal).is.approximately(+utils.formatUnits(rewardsTotalAmount, rtDecimals),
      +utils.formatUnits(rewardsTotalAmount, rtDecimals) * 0.01, 'total claimed not enough');
  });


  it("check reward with transfers", async () => {

    const underlying = await UniswapUtils.addLiquidity(
      signer,
      networkToken,
      usdc,
      utils.parseUnits('10000').toString(),
      utils.parseUnits('10000', 6).toString(),
      factory,
      router
    );
    const rt = networkToken;

    // ******** DEPLOY VAULT *******
    const vault = await DeployerUtils.deploySmartVault(signer);
    const strategy = await DeployerUtils.deployContract(signer, "NoopStrategy",
      core.controller.address, underlying, vault.address, [Misc.ZERO_ADDRESS], [networkToken, usdc], 1) as NoopStrategy;
    await vault.initializeSmartVault(
      "NOOP",
      "tNOOP",
      core.controller.address,
      underlying,
      60 * 60 * 24 * 28,
      false,
      Misc.ZERO_ADDRESS,
      0
    );
    await core.controller.addVaultsAndStrategies([vault.address], [strategy.address]);
    await core.vaultController.addRewardTokens([vault.address], rt);

    // ********** INIT VARS **************
    const user1 = (await ethers.getSigners())[1];
    const rtDecimals = await TokenUtils.decimals(rt);
    const underlyingDec = await TokenUtils.decimals(underlying);
    const duration = (await vault.duration()).toNumber();
    const time = 60 * 60 * 24 * 7;
    const rewardsTotalAmount = utils.parseUnits('10', rtDecimals);

    console.log('underlying amount', utils.formatUnits(await TokenUtils.balanceOf(underlying, signer.address), underlyingDec));

    await TokenUtils.getToken(rt, signer.address, utils.parseUnits('300'));
    await TokenUtils.approve(rt, signer, vault.address, rewardsTotalAmount.toString());
    await vault.notifyTargetRewardAmount(rt, rewardsTotalAmount);


    const signerUndBal = +utils.formatUnits(await TokenUtils.balanceOf(underlying, signer.address), underlyingDec);
    const signerDeposit = (signerUndBal * 0.5).toFixed(underlyingDec);

    await VaultUtils.deposit(signer, vault, utils.parseUnits(signerDeposit, underlyingDec));
    console.log('signer deposited');

    const signerShareBal = await TokenUtils.balanceOf(vault.address, signer.address);

    // clean address
    await TokenUtils.transfer(rt, signer, core.feeRewardForwarder.address, (await TokenUtils.balanceOf(rt, signer.address)).toString());

    // *************** CYCLES *************
    let claimedTotal = 0;
    const cycles = +(duration / (time + 3)).toFixed(0);
    console.log('cycles', cycles);
    for (let i = 0; i < cycles; i++) {
      console.log('cycle', i, cycles);
      await TimeUtils.advanceBlocksOnTs(time / 2);

      // send a part of share to user1
      await TokenUtils.transfer(vault.address, signer, user1.address,
        signerShareBal.div((cycles * 2).toFixed(0)).toString());

      const vaultRtBalance = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address), rtDecimals);

      const _rtBalanceSigner = +utils.formatUnits(await TokenUtils.balanceOf(rt, signer.address), rtDecimals);
      const rtBalanceUser1 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user1.address), rtDecimals);

      // signer claim
      const _toClaimSigner = +utils.formatUnits(await vault.earnedWithBoost(rt, signer.address), rtDecimals);
      const _toClaimSignerFullBoost = +utils.formatUnits(await vault.earned(rt, signer.address), rtDecimals);
      console.log('Signer toClaim', _toClaimSigner, 'all rewards in vault', vaultRtBalance, 'rt balance', _rtBalanceSigner, '100%', _toClaimSignerFullBoost);
      expect(_toClaimSigner).is.greaterThan(0, 'to claim signer is zero ' + i);
      await vault.getAllRewards();

      await TimeUtils.advanceBlocksOnTs(time / 2);

      // user1 claim
      const toClaimUser1 = +utils.formatUnits(await vault.earnedWithBoost(rt, user1.address), rtDecimals);
      const toClaimUser1FullBoost = +utils.formatUnits(await vault.earned(rt, user1.address), rtDecimals);
      console.log('User1 toClaim', toClaimUser1, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceUser1, '100%', toClaimUser1FullBoost);
      expect(toClaimUser1).is.greaterThan(0, 'to claim user1 is zero ' + i);
      await vault.connect(user1).getAllRewards();

      const _claimedSigner = +utils.formatUnits(await TokenUtils.balanceOf(rt, signer.address), rtDecimals) - _rtBalanceSigner;
      console.log('claimedSigner', _claimedSigner);
      claimedTotal += _claimedSigner;

      const claimedUser1 = +utils.formatUnits(await TokenUtils.balanceOf(rt, user1.address), rtDecimals) - rtBalanceUser1;
      console.log('claimedUser1', claimedUser1);
      claimedTotal += claimedUser1;


      expect(_claimedSigner).is.greaterThan(0);
      expect(claimedUser1).is.greaterThan(0);
      expect(_toClaimSigner).is.approximately(_claimedSigner, _claimedSigner * 0.01, 'signer claimed not enough ' + i);
      expect(toClaimUser1).is.approximately(claimedUser1, claimedUser1 * 0.01, 'user1 claimed not enough ' + i);
    }

    await TimeUtils.advanceBlocksOnTs(time * 2);

    const rtBalanceSigner = +utils.formatUnits(await TokenUtils.balanceOf(rt, signer.address), rtDecimals);

    // signer claim
    const toClaimSigner = +utils.formatUnits(await vault.earnedWithBoost(rt, signer.address), rtDecimals);
    const toClaimSignerFullBoost = +utils.formatUnits(await vault.earned(rt, signer.address), rtDecimals);
    console.log('Signer toClaim', toClaimSigner, '100%', toClaimSignerFullBoost);
    expect(toClaimSigner).is.greaterThan(0, 'to claim signer is zero ');
    await vault.getAllRewards();


    const claimedSigner = +utils.formatUnits(await TokenUtils.balanceOf(rt, signer.address), rtDecimals) - rtBalanceSigner;
    console.log('claimedSigner', claimedSigner);
    claimedTotal += claimedSigner;

    const controllerBal = +utils.formatUnits(await TokenUtils.balanceOf(rt, core.controller.address), rtDecimals);
    console.log('controller bal', controllerBal);
    console.log('claimedTotal', claimedTotal, +utils.formatUnits(rewardsTotalAmount, rtDecimals));
    expect(claimedTotal + controllerBal).is.approximately(+utils.formatUnits(rewardsTotalAmount, rtDecimals),
      +utils.formatUnits(rewardsTotalAmount, rtDecimals) * 0.01, 'total claimed not enough');

    await vault.exit();
  });


});
