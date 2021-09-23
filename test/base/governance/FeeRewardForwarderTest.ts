import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Controller, FeeRewardForwarder, IStrategy, SmartVault} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtils} from "../../../scripts/deploy/DeployerUtils";
import {TimeUtils} from "../../TimeUtils";
import {UniswapUtils} from "../../UniswapUtils";
import {CoreContractsWrapper} from "../../CoreContractsWrapper";
import {utils} from "ethers";
import {Erc20Utils} from "../../Erc20Utils";

const {expect} = chai;
chai.use(chaiAsPromised);

describe("Fee reward forwarder tests", function () {
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signerAddress: string;
  let core: CoreContractsWrapper;
  let forwarder: FeeRewardForwarder;

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    signer = (await ethers.getSigners())[0];
    signer1 = (await ethers.getSigners())[1];
    signerAddress = signer.address;
    core = await DeployerUtils.deployAllCoreContracts(signer);
    forwarder = core.feeRewardForwarder;
    await UniswapUtils.wrapMatic(signer); // 10m wmatic
    await UniswapUtils.buyToken(signer, MaticAddresses.SUSHI_ROUTER, MaticAddresses.USDC_TOKEN, utils.parseUnits('100000'));
    await UniswapUtils.createPairForRewardToken(signer, core, '100000');
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

  it("should not setup empty conv path", async () => {
    await expect(forwarder.setConversionPath([], [])).rejectedWith('FRF: Wrong data');
  });

  it("should not setup wrong conv path", async () => {
    await expect(forwarder.setConversionPath([MaticAddresses.ZERO_ADDRESS, MaticAddresses.ZERO_ADDRESS],
        [MaticAddresses.ZERO_ADDRESS, MaticAddresses.ZERO_ADDRESS])).rejectedWith('FRF: Wrong data');
  });

  it("should not notify ps with zero target token", async () => {
    const controllerLogic = await DeployerUtils.deployContract(signer, "Controller");
    const controllerProxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", controllerLogic.address);
    const controller = controllerLogic.attach(controllerProxy.address) as Controller;
    await controller.initialize();
    const feeRewardForwarder = await DeployerUtils.deployFeeForwarder(signer, controller.address);
    await expect(feeRewardForwarder.callStatic.notifyPsPool(MaticAddresses.ZERO_ADDRESS, 1)).is.rejectedWith('FRF: Target token is zero for notify')
  });

  it("should not notify ps without liq path", async () => {
    await expect(forwarder.notifyPsPool(MaticAddresses.ZERO_ADDRESS, '1')).rejectedWith('FRF: Liquidation path not found for target token');
  });

  it("should not notify vault without xTETU", async () => {
    const data = await DeployerUtils.deployAndInitVaultAndStrategy(
        't',
        vaultAddress => DeployerUtils.deployContract(
            signer,
            'StrategyWaultSingle',
            core.controller.address,
            vaultAddress,
            MaticAddresses.WEXpoly_TOKEN,
            1
        ) as Promise<IStrategy>,
        core.controller,
        core.vaultController,
        MaticAddresses.WMATIC_TOKEN,
        signer
    );
    const vault = data[1] as SmartVault;
    await expect(forwarder.notifyCustomPool(MaticAddresses.WMATIC_TOKEN, vault.address, '1')).rejectedWith('psToken not added to vault');
  });

  it("should not notify vault without liq path", async () => {
    const data = await DeployerUtils.deployAndInitVaultAndStrategy(
        't',
        vaultAddress => DeployerUtils.deployContract(
            signer,
            'StrategyWaultSingle',
            core.controller.address,
            vaultAddress,
            MaticAddresses.WEXpoly_TOKEN,
            1
        ) as Promise<IStrategy>,
        core.controller,
        core.vaultController,
        MaticAddresses.WMATIC_TOKEN,
        signer
    );
    const vault = data[1] as SmartVault;
    await core.vaultController.addRewardTokens([vault.address], core.psVault.address);
    await expect(forwarder.notifyCustomPool(MaticAddresses.WMATIC_TOKEN, vault.address, '1')).rejectedWith('FRF: Liquidation path not found for target token');
  });

  it("should notify ps single liq path", async () => {
    await core.feeRewardForwarder.setConversionPath(
        [MaticAddresses.USDC_TOKEN, core.rewardToken.address],
        [MaticAddresses.QUICK_ROUTER]
    );
    await Erc20Utils.approve(MaticAddresses.USDC_TOKEN, signer, forwarder.address, utils.parseUnits('1000', 6).toString());
    expect(await forwarder.callStatic.notifyPsPool(MaticAddresses.USDC_TOKEN, utils.parseUnits('1000', 6))).is.not.eq(0);
  });

  it("should distribute", async () => {
    await core.feeRewardForwarder.setConversionPath(
        [MaticAddresses.USDC_TOKEN, core.rewardToken.address],
        [MaticAddresses.QUICK_ROUTER]
    );
    await Erc20Utils.approve(MaticAddresses.USDC_TOKEN, signer, forwarder.address, utils.parseUnits('1000', 6).toString());
    expect(await forwarder.callStatic.distribute(utils.parseUnits('1000', 6), MaticAddresses.USDC_TOKEN, core.psVault.address)).is.not.eq(0);
  });

});
