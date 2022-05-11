import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Announcer, Controller, IStrategy, TetuProxyControlled} from "../../../typechain";
import {ethers, web3} from "hardhat";
import {DeployerUtils} from "../../../scripts/deploy/DeployerUtils";
import {TimeUtils} from "../../TimeUtils";
import {UniswapUtils} from "../../UniswapUtils";
import {CoreContractsWrapper} from "../../CoreContractsWrapper";
import {TokenUtils} from "../../TokenUtils";
import {BigNumber, utils} from "ethers";
import {MintHelperUtils} from "../../MintHelperUtils";
import {VaultUtils} from "../../VaultUtils";
import {Misc} from "../../../scripts/utils/tools/Misc";

const {expect} = chai;
chai.use(chaiAsPromised);

describe("Announcer tests", function () {
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let core: CoreContractsWrapper;
  let controller: Controller;
  let announcer: Announcer;
  let timeLockDuration: number;
  let usdc: string;

  before(async function () {
    signer = await DeployerUtils.impersonate();
    signer1 = (await ethers.getSigners())[1];
    core = await DeployerUtils.deployAllCoreContracts(signer);
    snapshotBefore = await TimeUtils.snapshot();
    controller = core.controller;
    announcer = core.announcer;
    timeLockDuration = (await core.announcer.timeLock()).toNumber();
    usdc = await DeployerUtils.getUSDCAddress();
    await UniswapUtils.wrapNetworkToken(signer); // 10m wmatic
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });


  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  it("should close announce", async () => {
    const opCode = 9;
    const num = 7;
    const den = 56;

    await announcer.announceAddressChange(0, signer1.address);
    await announcer.announceRatioChange(opCode, num, den);
    await announcer.announceAddressChange(1, signer1.address);

    expect(await announcer.timeLockInfosLength()).is.eq(4);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(2);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(2);
    expect(info.numValues[0]).is.eq(num);
    expect(info.numValues[1]).is.eq(den);

    const opHash = web3.utils.keccak256(web3.utils.encodePacked(opCode, num, den) as string);
    expect(await announcer.timeLockSchedule(opHash)).is.not.eq(0);

    await announcer.closeAnnounce(opCode, opHash, Misc.ZERO_ADDRESS);
    expect(await announcer.timeLockIndexes(opCode)).is.eq(0);
    expect(await announcer.timeLockSchedule(opHash)).is.eq(0);
  });

  it("should change gov with time-lock", async () => {
    const opCode = 0;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setGovernance(signer1.address);

    expect(await controller.governance()).is.eq(signer1.address);
  });

  it("should change dao with time-lock", async () => {
    const opCode = 1;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setDao(signer1.address);

    expect(await controller.dao()).is.eq(signer1.address);
  });

  it("should change FeeRewardForwarder with time-lock", async () => {
    const opCode = 2;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setFeeRewardForwarder(signer1.address);

    expect(await controller.feeRewardForwarder()).is.eq(signer1.address);
  });

  it("should change Bookkeeper with time-lock", async () => {
    const opCode = 3;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setBookkeeper(signer1.address);

    expect(await controller.bookkeeper()).is.eq(signer1.address);
  });

  it("should change MintHelper with time-lock", async () => {
    const opCode = 4;

    const mintHelper = (await DeployerUtils.deployMintHelper(
      signer, core.controller.address, [signer.address], [3000]))[0].address;

    await announcer.announceAddressChange(opCode, mintHelper);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(mintHelper);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setMintHelper(mintHelper);

    expect(await controller.mintHelper()).is.eq(mintHelper);
  });

  it("should change RewardToken with time-lock", async () => {
    const opCode = 5;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setRewardToken(signer1.address);

    expect(await controller.rewardToken()).is.eq(signer1.address);
  });

  it("should change FundToken with time-lock", async () => {
    const opCode = 6;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setFundToken(signer1.address);

    expect(await controller.fundToken()).is.eq(signer1.address);
  });

  it("should change PsVault with time-lock", async () => {
    const opCode = 7;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setPsVault(signer1.address);

    expect(await controller.psVault()).is.eq(signer1.address);
  });

  it("should change Fund with time-lock", async () => {
    const opCode = 8;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setFund(signer1.address);

    expect(await controller.fund()).is.eq(signer1.address);
  });

  it("should change vault controller with time-lock", async () => {
    const opCode = 19;
    await announcer.announceAddressChange(opCode, signer1.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(signer1.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setVaultController(signer1.address);

    expect(await controller.vaultController()).is.eq(signer1.address);
  });

  it("should change ps ratio with time-lock", async () => {
    const opCode = 9;
    const num = 7;
    const den = 56;
    await announcer.announceRatioChange(opCode, num, den);

    const opHash = web3.utils.keccak256(web3.utils.encodePacked(opCode, num, den) as string);
    expect(await announcer.timeLockSchedule(opHash)).is.not.eq(0);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(2);
    expect(info.numValues[0]).is.eq(num);
    expect(info.numValues[1]).is.eq(den);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setPSNumeratorDenominator(num, den);

    expect(await controller.psNumerator()).is.eq(num);
    expect(await controller.psDenominator()).is.eq(den);
  });

  it("should change fund ratio with time-lock", async () => {
    const opCode = 10;
    const num = 7;
    const den = 56;
    await announcer.announceRatioChange(opCode, num, den);

    const opHash = web3.utils.keccak256(web3.utils.encodePacked(opCode, num, den) as string);
    expect(await announcer.timeLockSchedule(opHash)).is.not.eq(0);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(2);
    expect(info.numValues[0]).is.eq(num);
    expect(info.numValues[1]).is.eq(den);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setFundNumeratorDenominator(num, den);

    expect(await controller.fundNumerator()).is.eq(num);
    expect(await controller.fundDenominator()).is.eq(den);
  });

  it("should controller token salvage with time-lock", async () => {
    const opCode = 11;
    const amount = 1000;

    await TokenUtils.getToken(usdc, signer.address, BigNumber.from(amount));
    await TokenUtils.transfer(usdc, signer, core.controller.address, amount.toString());

    const balUser = await TokenUtils.balanceOf(usdc, signer.address);
    const balController = await TokenUtils.balanceOf(usdc, core.controller.address);

    await announcer.announceTokenMove(opCode, signer.address, usdc, amount);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(signer.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0].toLowerCase()).is.eq(usdc);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(amount);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.controllerTokenMove(signer.address, usdc, amount);

    const balUserAfter = await TokenUtils.balanceOf(usdc, signer.address);
    const balControllerAfter = await TokenUtils.balanceOf(usdc, core.controller.address);

    expect(balUserAfter).is.eq(balUser.add(amount));
    expect(balControllerAfter).is.eq(balController.sub(amount));
  });

  it("should strategy token salvage with time-lock", async () => {
    const opCode = 12;
    const amount = 1000;
    const contract = await core.psVault.strategy();

    await TokenUtils.getToken(usdc, signer.address, BigNumber.from(amount));
    await TokenUtils.transfer(usdc, signer, contract, amount.toString());

    const balUser = await TokenUtils.balanceOf(usdc, signer.address);
    const balContract = await TokenUtils.balanceOf(usdc, contract);

    await announcer.announceTokenMove(opCode, contract, usdc, amount);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(contract);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0].toLowerCase()).is.eq(usdc);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(amount);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.strategyTokenMove(contract, usdc, amount);

    const balUserAfter = await TokenUtils.balanceOf(usdc, signer.address);
    const balContractAfter = await TokenUtils.balanceOf(usdc, contract);

    expect(balUserAfter).is.eq(balUser.add(amount));
    expect(balContractAfter).is.eq(balContract.sub(amount));
  });

  it("should set reward boost duration", async () => {
    const opCode = 20;
    const amount = 1;

    await announcer.announceUintChange(opCode, amount);
    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(Misc.ZERO_ADDRESS);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(amount);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await core.vaultController.setRewardBoostDuration(amount);

    expect(await core.vaultController.rewardBoostDuration()).is.eq(amount);
  });

  it("should set RewardRatioWithoutBoost", async () => {
    const opCode = 21;
    const amount = 1;

    await announcer.announceUintChange(opCode, amount);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(Misc.ZERO_ADDRESS);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(amount);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await core.vaultController.setRewardRatioWithoutBoost(amount);

    expect(await core.vaultController.rewardRatioWithoutBoost()).is.eq(amount);
  });

  it("should fund token salvage with time-lock", async () => {
    const opCode = 13;
    const amount = 1000;
    const contract = core.fundKeeper.address;

    await TokenUtils.getToken(usdc, signer.address, BigNumber.from(amount));
    await TokenUtils.transfer(usdc, signer, contract, amount.toString());

    const balUser = await TokenUtils.balanceOf(usdc, core.controller.address);
    const balContract = await TokenUtils.balanceOf(usdc, contract);

    await announcer.announceTokenMove(opCode, contract, usdc, amount);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(contract);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0].toLowerCase()).is.eq(usdc);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(amount);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.fundKeeperTokenMove(contract, usdc, amount);

    const balUserAfter = await TokenUtils.balanceOf(usdc, core.controller.address);
    const balContractAfter = await TokenUtils.balanceOf(usdc, contract);

    expect(balUserAfter).is.eq(balUser.add(amount));
    expect(balContractAfter).is.eq(balContract.sub(amount));
  });

  it("should upgrade proxy with time-lock", async () => {
    const opCode = 14;

    const proxyAdr = core.psVault.address;
    const proxy = await DeployerUtils.connectContract(signer, 'TetuProxyControlled', proxyAdr) as TetuProxyControlled;
    const newImpl = await DeployerUtils.deployContract(signer, 'SmartVault');

    await announcer.announceTetuProxyUpgradeBatch([proxyAdr], [newImpl.address]);

    const index = await announcer.multiTimeLockIndexes(opCode, proxyAdr);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(proxyAdr);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(newImpl.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.upgradeTetuProxyBatch([proxyAdr], [newImpl.address]);

    expect(await proxy.implementation()).is.eq(newImpl.address);
    expect(await announcer.multiTimeLockIndexes(opCode, proxyAdr)).is.eq(0);
  });

  it("should upgrade strategy with time-lock", async () => {
    const opCode = 15;

    const target = core.psVault.address;
    const newImpl = await DeployerUtils.deployContract(signer, 'NoopStrategy',
      controller.address, core.rewardToken.address, core.psVault.address, [], [core.rewardToken.address], 1) as IStrategy;

    await announcer.announceStrategyUpgrades([target], [newImpl.address]);

    const index = await announcer.multiTimeLockIndexes(opCode, target);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(target);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(newImpl.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setVaultStrategyBatch([target], [newImpl.address]);

    expect(await core.psVault.strategy()).is.eq(newImpl.address);
  });

  it("should stop vault with time-lock", async () => {
    const opCode = 22;
    const target = core.psVault.address;
    const amount = utils.parseUnits('1000', 6);

    const rt = usdc;
    await MintHelperUtils.mint(core.controller, core.announcer, '1000', signer.address);
    await TokenUtils.getToken(usdc, signer.address, amount);
    await core.vaultController.addRewardTokens([target], rt);
    await TokenUtils.approve(rt, signer, target, amount.toString());
    await core.psVault.notifyTargetRewardAmount(rt, amount);
    await VaultUtils.deposit(signer, core.psVault, BigNumber.from('10'));

    expect(await TokenUtils.balanceOf(rt, target)).is.not.equal(0);
    expect(await TokenUtils.balanceOf(rt, core.controller.address)).is.equal(0);

    await announcer.announceVaultStopBatch([target]);
    const index = await announcer.multiTimeLockIndexes(opCode, target);
    expect(index).is.eq(2);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(target);
    expect(info.adrValues.length).is.eq(0);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);
    await core.vaultController.stopVaultsBatch([target]);
    expect(await core.psVault.active()).is.eq(false);
    expect(await TokenUtils.balanceOf(rt, target)).is.equal(0);
    expect(await TokenUtils.balanceOf(rt, core.controller.address)).is.not.equal(0);
    await core.psVault.exit();
  });

  it("should mint with time-lock", async () => {
    const opCode = 16;
    const balanceSigner = await TokenUtils.balanceOf(core.rewardToken.address, signer.address);
    const balanceNotifier = await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address);
    const balanceFund = await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address);

    const toMint = 10_000;
    await announcer.announceMint(toMint, core.notifyHelper.address, core.fundKeeper.address, false);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);

    expect(info.target).is.eq(core.mintHelper.address);
    expect(info.adrValues.length).is.eq(2);
    expect(info.adrValues[0]).is.eq(core.notifyHelper.address);
    expect(info.adrValues[1]).is.eq(core.fundKeeper.address);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(toMint);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.mintAndDistribute(toMint, false);

    const curNetAmount = toMint * 0.33;
    const forVaults = curNetAmount * 0.7;
    const forDev = curNetAmount * 0.3;

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address))
      .is.eq(balanceNotifier.add(forVaults));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address))
      .is.eq(balanceFund.add(toMint - curNetAmount));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, signer.address))
      .is.eq(balanceSigner.add(forDev));
  });

  it("should change Announcer with time-lock", async () => {
    const opCode = 17;

    const newAnnouncer = (await DeployerUtils.deployAnnouncer(signer, core.controller.address, 1))[0];

    await announcer.announceAddressChange(opCode, newAnnouncer.address);

    const index = await announcer.timeLockIndexes(opCode);
    expect(index).is.eq(1);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.controller.address);
    expect(info.adrValues.length).is.eq(1);
    expect(info.adrValues[0]).is.eq(newAnnouncer.address);
    expect(info.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.setAnnouncer(newAnnouncer.address);

    expect(await controller.announcer()).is.eq(newAnnouncer.address);
  });

  it("should not mint zero amount", async () => {
    await expect(core.announcer.announceMint(0, core.notifyHelper.address, core.fundKeeper.address, false))
      .rejectedWith('zero amount');
  });

  it("should make multiple time-lock changes", async () => {
    const opCodeMint = 16;
    const opCodeGovChange = 0;

    // mint
    const toMint = 10_000;
    let balanceSigner = await TokenUtils.balanceOf(core.rewardToken.address, signer.address);
    let balanceNotifier = await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address);
    let balanceFund = await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address);

    await announcer.announceMint(toMint, core.notifyHelper.address, core.fundKeeper.address, false);
    await announcer.announceAddressChange(opCodeGovChange, signer1.address);

    const indexMint = await announcer.timeLockIndexes(opCodeMint);
    expect(indexMint).is.eq(1);

    const infoMint = await announcer.timeLockInfo(indexMint);

    expect(infoMint.target).is.eq(core.mintHelper.address);
    expect(infoMint.adrValues.length).is.eq(2);
    expect(infoMint.adrValues[0]).is.eq(core.notifyHelper.address);
    expect(infoMint.adrValues[1]).is.eq(core.fundKeeper.address);
    expect(infoMint.numValues.length).is.eq(1);
    expect(infoMint.numValues[0]).is.eq(toMint);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.mintAndDistribute(toMint,  false);

    let curNetAmount = toMint * 0.33;
    let forVaults = curNetAmount * 0.7;
    let forDev = curNetAmount * 0.3;

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address))
      .is.eq(balanceNotifier.add(forVaults));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address))
      .is.eq(balanceFund.add(toMint - curNetAmount));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, signer.address))
      .is.eq(balanceSigner.add(forDev));

    console.log('mint first completed');

    await announcer.announceMint(toMint, core.notifyHelper.address, core.fundKeeper.address, false);

    // set governance
    const indexGovChange = await announcer.timeLockIndexes(opCodeGovChange);
    console.log('indexGovChange', indexGovChange);
    expect(indexGovChange).is.eq(2);

    const infoGovChange = await announcer.timeLockInfo(indexGovChange);
    expect(infoGovChange.opCode).is.eq(opCodeGovChange);
    expect(infoGovChange.target).is.eq(core.controller.address);
    expect(infoGovChange.adrValues.length).is.eq(1);
    expect(infoGovChange.adrValues[0]).is.eq(signer1.address);
    expect(infoGovChange.numValues.length).is.eq(0);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    console.log('set gov');
    await controller.setGovernance(signer1.address);

    expect(await controller.governance()).is.eq(signer1.address);

    console.log('gov change completed')


    // announcer.closeAnnounce(opCodeMint, )


    // mint 2
    balanceSigner = await TokenUtils.balanceOf(core.rewardToken.address, signer.address);
    balanceNotifier = await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address);
    balanceFund = await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address);

    const index = await announcer.timeLockIndexes(opCodeMint);
    expect(index).is.eq(3);

    const info = await announcer.timeLockInfo(index);
    expect(info.target).is.eq(core.mintHelper.address);
    expect(info.adrValues.length).is.eq(2);
    expect(info.adrValues[0]).is.eq(core.notifyHelper.address);
    expect(info.adrValues[1]).is.eq(core.fundKeeper.address);
    expect(info.numValues.length).is.eq(1);
    expect(info.numValues[0]).is.eq(toMint);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.connect(signer1).mintAndDistribute(toMint,  false);

    curNetAmount = toMint * 0.33;
    forVaults = curNetAmount * 0.7;
    forDev = curNetAmount * 0.3;

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.notifyHelper.address))
      .is.eq(balanceNotifier.add(forVaults));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, core.fundKeeper.address))
      .is.eq(balanceFund.add(toMint - curNetAmount));

    expect(await TokenUtils.balanceOf(core.rewardToken.address, signer.address))
      .is.eq(balanceSigner.add(forDev));
  });

  it("should make multiple time-lock changes 2", async () => {
    const opCodeMint = 16;
    const opCodeGovChange = 0;
    const not = '0x099C314F792e1F91f53765Fc64AaDCcf4dCf1538';
    await controller.setDistributor(not);
    const fk = await controller.fund();

    // mint
    await announcer.announceMint(0, not, fk, true);
    await announcer.announceAddressChange(opCodeGovChange, signer1.address);


    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.mintAndDistribute(0, true);
    console.log('mint first completed');

    await announcer.announceMint(0, not, fk, true);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    console.log('set gov');
    await controller.setGovernance(signer1.address);

    expect(await controller.governance()).is.eq(signer1.address);

    console.log('gov change completed');


    await announcer.connect(signer1).closeAnnounce(opCodeMint, '0x3b547b6d5a058f0c4e79c98ef8e0536512f4687c9958e7b870e1ccbe47694c33', Misc.ZERO_ADDRESS);

    // *************** CHANGE ANNOUNCER
    const changeAnnouncer = 17;

    const newAnnouncer = (await DeployerUtils.deployAnnouncer(signer, core.controller.address, 1))[0];

    await announcer.connect(signer1).announceAddressChange(changeAnnouncer, newAnnouncer.address);

    await TimeUtils.advanceBlocksOnTs(timeLockDuration);

    await controller.connect(signer1).setAnnouncer(newAnnouncer.address);

    expect(await controller.announcer()).is.eq(newAnnouncer.address);

    // ******************
    const WEEK = 60 * 60 * 24 * 7;

    await newAnnouncer.connect(signer1).announceMint(0, core.notifyHelper.address, fk, true);

    // mint 2
    await controller.connect(signer1).setDistributor(core.notifyHelper.address);
    await TimeUtils.advanceBlocksOnTs(WEEK * 4);
    await controller.connect(signer1).mintAndDistribute(0, true);

    await newAnnouncer.connect(signer1).announceMint(0, core.notifyHelper.address, fk, true);

    // mint 3
    await TimeUtils.advanceBlocksOnTs(WEEK * 4);
    await controller.connect(signer1).mintAndDistribute(0, true);

    await newAnnouncer.connect(signer1).announceMint(0, core.notifyHelper.address, fk, true);

    // mint 4
    await TimeUtils.advanceBlocksOnTs(WEEK * 4);
    await controller.connect(signer1).mintAndDistribute(0, true);
  });

});
