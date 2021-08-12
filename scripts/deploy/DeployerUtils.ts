import {ethers, web3} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, ContractFactory, utils} from "ethers";
import {
  Announcer,
  Bookkeeper,
  ContractReader,
  Controller,
  FeeRewardForwarder,
  FundKeeper,
  IStrategy,
  ITetuProxy,
  LiquidityBalancer,
  MintHelper,
  MultiSwap,
  NoopStrategy,
  NotifyHelper,
  PayrollClerk,
  PriceCalculator,
  RewardToken,
  SmartVault,
  TetuProxyControlled,
  TetuProxyGov,
  ZapContract,
} from "../../typechain";
import {expect} from "chai";
import {CoreContractsWrapper} from "../../test/CoreContractsWrapper";
import {Addresses} from "../../addresses";
import {CoreAddresses} from "../models/CoreAddresses";
import {ToolsAddresses} from "../models/ToolsAddresses";
import axios from "axios";
import {Secrets} from "../../secrets";
import {RunHelper} from "../utils/RunHelper";
import {MaticAddresses} from "../../test/MaticAddresses";

const hre = require("hardhat");

export class DeployerUtils {

  // ************ CONTRACT CONNECTION **************************

  public static async connectContract<T extends ContractFactory>(
      signer: SignerWithAddress,
      name: string,
      address: string
  ) {
    const factory = (await ethers.getContractFactory(
        name,
        signer
    )) as T;
    const instance = await factory.connect(signer);
    return instance.attach(address);
  }

  public static async connectInterface<T extends Contract>(
      signer: SignerWithAddress,
      name: string,
      address: string
  ) {
    return await ethers.getContractAt(name, address, signer);
  }

  public static async connectVault(address: string, signer: SignerWithAddress): Promise<SmartVault> {
    const proxy = await DeployerUtils.connectContract(signer, "TetuProxyControlled", address) as TetuProxyControlled;
    const logicAddress = await proxy.implementation();
    const logic = await DeployerUtils.connectContract(signer, "SmartVault", logicAddress) as SmartVault;
    return logic.attach(proxy.address);
  }

  public static async connectProxy(address: string, signer: SignerWithAddress, name: string): Promise<any> {
    const proxy = await DeployerUtils.connectInterface(signer, "ITetuProxy", address) as ITetuProxy;
    const logicAddress = await proxy.callStatic.implementation();
    const logic = await DeployerUtils.connectContract(signer, name, logicAddress);
    return logic.attach(proxy.address);
  }

  // ************ CONTRACT DEPLOY **************************

  public static async deployContract<T extends ContractFactory>(
      signer: SignerWithAddress,
      name: string,
      ...args: Array<any>
  ) {
    console.log(`Deploying ${name}`);
    console.log("Account balance:", utils.formatUnits(await signer.getBalance(), 18));

    const gasPrice = await web3.eth.getGasPrice();
    console.log("Gas price:", gasPrice);

    const factory = (await ethers.getContractFactory(
        name,
        signer
    )) as T;
    const instance = await factory.deploy(...args);
    await instance.deployed();
    console.log(name + ' deployed', instance.address);
    return instance;
  }

  public static async deployController(signer: SignerWithAddress): Promise<Controller> {
    const logic = await DeployerUtils.deployContract(signer, "Controller");
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address);
    const contract = logic.attach(proxy.address) as Controller;
    await contract.initialize();
    return contract;
  }

  public static async deployAnnouncer(signer: SignerWithAddress, controller: string, timeLock: number)
      : Promise<[Announcer, TetuProxyControlled, Announcer]> {
    const logic = await DeployerUtils.deployContract(signer, "Announcer") as Announcer;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address) as TetuProxyControlled;
    const contract = logic.attach(proxy.address) as Announcer;
    await contract.initialize(controller, timeLock);
    return [contract, proxy, logic];
  }

  public static async deployFeeForwarder(signer: SignerWithAddress, controllerAddress: string): Promise<FeeRewardForwarder> {
    return await DeployerUtils.deployContract(
        signer, "FeeRewardForwarder", controllerAddress) as FeeRewardForwarder;
  }

  public static async deployMintHelper(
      signer: SignerWithAddress,
      controllerAddress: string,
      funds: string[],
      fractions: number[]
  ): Promise<[MintHelper, TetuProxyControlled, MintHelper]> {
    const logic = await DeployerUtils.deployContract(signer, "MintHelper") as MintHelper;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address) as TetuProxyControlled;
    const contract = logic.attach(proxy.address) as MintHelper;
    await contract.initialize(controllerAddress, funds, fractions);

    return [contract, proxy, logic];
  }

  public static async deployBookkeeper(signer: SignerWithAddress, controller: string): Promise<Bookkeeper> {
    const logic = await DeployerUtils.deployContract(signer, "Bookkeeper");
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address);
    const bookkeeper = logic.attach(proxy.address) as Bookkeeper;
    await bookkeeper.initialize(controller);
    return bookkeeper;
  }

  public static async deployFundKeeper(signer: SignerWithAddress, controller: string): Promise<[FundKeeper, TetuProxyControlled, FundKeeper]> {
    const logic = await DeployerUtils.deployContract(signer, "FundKeeper") as FundKeeper;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address) as TetuProxyControlled;
    const fundKeeper = logic.attach(proxy.address) as FundKeeper;
    await fundKeeper.initialize(controller);
    return [fundKeeper, proxy, logic];
  }

  public static async deployLiquidityBalancer(signer: SignerWithAddress, controller: string): Promise<LiquidityBalancer> {
    return await DeployerUtils.deployContract(signer, "LiquidityBalancer", controller) as LiquidityBalancer;
  }

  public static async deployPriceCalculatorMatic(signer: SignerWithAddress, controller: string): Promise<[PriceCalculator, TetuProxyGov, PriceCalculator]> {
    const logic = await DeployerUtils.deployContract(signer, "PriceCalculator") as PriceCalculator;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", logic.address) as TetuProxyGov;
    const calculator = logic.attach(proxy.address) as PriceCalculator;
    await calculator.initialize(controller);

    await calculator.addKeyTokens([
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.WETH_TOKEN,
      MaticAddresses.DAI_TOKEN,
      MaticAddresses.USDT_TOKEN,
      MaticAddresses.WBTC_TOKEN,
      MaticAddresses.WMATIC_TOKEN,
      MaticAddresses.QUICK_TOKEN,
    ]);
    await calculator.setDefaultToken(MaticAddresses.USDC_TOKEN);
    await calculator.addSwapPlatform(MaticAddresses.QUICK_FACTORY, "Uniswap V2");
    await calculator.addSwapPlatform(MaticAddresses.SUSHI_FACTORY, "SushiSwap LP Token");
    await calculator.addSwapPlatform(MaticAddresses.WAULT_FACTORY, "WaultSwap LP");

    expect(await calculator.keyTokensSize()).is.not.eq(0);
    return [calculator, proxy, logic];
  }

  public static async deployPriceCalculatorTestNet(signer: SignerWithAddress, controller: string): Promise<[PriceCalculator, TetuProxyGov, PriceCalculator]> {
    const logic = await DeployerUtils.deployContract(signer, "PriceCalculator") as PriceCalculator;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", logic.address) as TetuProxyGov;
    const calculator = logic.attach(proxy.address) as PriceCalculator;
    await calculator.initialize(controller);
    const mocks = await DeployerUtils.getTokenAddresses();

    await calculator.addKeyTokens([
      mocks.get('usdc') as string
    ]);
    await calculator.setDefaultToken(mocks.get('usdc') as string);
    await calculator.addSwapPlatform(MaticAddresses.SUSHI_FACTORY, "SushiSwap LP Token");
    return [calculator, proxy, logic];
  }

  public static async deploySmartVault(signer: SignerWithAddress): Promise<SmartVault> {
    const logic = await DeployerUtils.deployContract(signer, "SmartVault");
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", logic.address);
    return logic.attach(proxy.address) as SmartVault;
  }

  public static async deployPayrollClerk(signer: SignerWithAddress, controller: string)
      : Promise<[PayrollClerk, TetuProxyGov, PayrollClerk]> {
    const logic = await DeployerUtils.deployContract(signer, "PayrollClerk") as PayrollClerk;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", logic.address) as TetuProxyGov;
    const contract = logic.attach(proxy.address) as PayrollClerk;
    await contract.initialize(controller);
    return [contract, proxy, logic];
  }

  public static async deployContractReader(signer: SignerWithAddress, controller: string, calculator: string)
      : Promise<[ContractReader, TetuProxyGov, ContractReader]> {
    const logic = await DeployerUtils.deployContract(signer, "ContractReader") as ContractReader;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", logic.address) as TetuProxyGov;
    const contract = logic.attach(proxy.address) as ContractReader;
    await contract.initialize(controller);
    await contract.setPriceCalculator(calculator);
    return [contract, proxy, logic];
  }

  public static async deployZapContract(
      signer: SignerWithAddress,
      controllerAddress: string,
      multiSwap: string
  ): Promise<[ZapContract, TetuProxyControlled, ZapContract]> {
    const logic = await DeployerUtils.deployContract(signer, "ZapContract") as ZapContract;
    const proxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", logic.address) as TetuProxyGov;
    const contract = logic.attach(proxy.address) as ZapContract;
    await contract.initialize(controllerAddress, multiSwap);

    return [contract, proxy, logic];
  }

  public static async deployMultiSwap(
      signer: SignerWithAddress,
      controllerAddress: string,
      calculatorAddress: string
  ): Promise<MultiSwap> {
    return await DeployerUtils.deployContract(signer, "MultiSwap",
        controllerAddress,
        calculatorAddress,
        [
          MaticAddresses.QUICK_FACTORY,
          MaticAddresses.SUSHI_FACTORY,
          MaticAddresses.WAULT_FACTORY
        ],
        [
          MaticAddresses.QUICK_ROUTER,
          MaticAddresses.SUSHI_ROUTER,
          MaticAddresses.WAULT_ROUTER
        ]
    ) as MultiSwap;
  }

  public static async deployAllCoreContracts(
      signer: SignerWithAddress,
      psRewardDuration: number = 60 * 60 * 24 * 28,
      timeLock: number = 60 * 60 * 48,
      wait = false
  ): Promise<CoreContractsWrapper> {
    // ************** CONTROLLER **********
    const controllerLogic = await DeployerUtils.deployContract(signer, "Controller");
    const controllerProxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", controllerLogic.address);
    const controller = controllerLogic.attach(controllerProxy.address) as Controller;
    await controller.initialize();

    // ************ ANNOUNCER **********
    const announcerData = await DeployerUtils.deployAnnouncer(signer, controller.address, timeLock);

    // ********* FEE FORWARDER *********
    const feeRewardForwarder = await DeployerUtils.deployFeeForwarder(signer, controller.address);

    // ********** BOOKKEEPER **********
    const bookkeeperLogic = await DeployerUtils.deployContract(signer, "Bookkeeper");
    const bookkeeperProxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", bookkeeperLogic.address);
    const bookkeeper = bookkeeperLogic.attach(bookkeeperProxy.address) as Bookkeeper;
    await bookkeeper.initialize(controller.address);

    // ********** FUND KEEPER **************
    const fundKeeperData = await DeployerUtils.deployFundKeeper(signer, controller.address);

    // ******* REWARD TOKEN AND SUPPORT CONTRACTS ******
    const notifyHelper = await DeployerUtils.deployContract(signer, "NotifyHelper", controller.address) as NotifyHelper;
    const mintHelperData = await DeployerUtils.deployMintHelper(signer, controller.address, [signer.address], [3000]);
    const rewardToken = await DeployerUtils.deployContract(signer, "RewardToken", mintHelperData[0].address) as RewardToken;


    // ****** PS ********
    const vaultLogic = await DeployerUtils.deployContract(signer, "SmartVault");
    const vaultProxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", vaultLogic.address);
    const psVault = vaultLogic.attach(vaultProxy.address) as SmartVault;
    const psEmptyStrategy = await DeployerUtils.deployContract(signer, "NoopStrategy",
        controller.address, rewardToken.address, psVault.address, [], [rewardToken.address]) as NoopStrategy;

    //!########### INIT ##############
    await RunHelper.runAndWait(() => psVault.initializeSmartVault(
        "TETU_PS",
        "xTETU",
        controller.address,
        rewardToken.address,
        psRewardDuration
    ), true, wait);

    // ******* SETUP CONTROLLER ********
    await RunHelper.runAndWait(() => controller.setFeeRewardForwarder(feeRewardForwarder.address), true, wait);
    await RunHelper.runAndWait(() => controller.setBookkeeper(bookkeeper.address), true, wait);
    await RunHelper.runAndWait(() => controller.setMintHelper(mintHelperData[0].address), true, wait);
    await RunHelper.runAndWait(() => controller.setRewardToken(rewardToken.address), true, wait);
    await RunHelper.runAndWait(() => controller.setPsVault(psVault.address), true, wait);
    await RunHelper.runAndWait(() => controller.setFund(fundKeeperData[0].address), true, wait);
    await RunHelper.runAndWait(() => controller.setAnnouncer(announcerData[0].address), true, wait);

    try {
      const tokens = await DeployerUtils.getTokenAddresses()
      await RunHelper.runAndWait(() => controller.setFundToken(tokens.get('usdc') as string), true, wait);
    } catch (e) {
      console.error('USDC token not defined for network, need to setup Fund token later');
    }
    await RunHelper.runAndWait(() => controller.setRewardDistribution(
        [
          feeRewardForwarder.address,
          notifyHelper.address
        ], true), true, wait);

    // need to add after adding bookkeeper
    await RunHelper.runAndWait(() =>
            controller.addVaultAndStrategy(psVault.address, psEmptyStrategy.address),
        true, wait);


    return new CoreContractsWrapper(
        controller,
        controllerLogic.address,
        feeRewardForwarder,
        bookkeeper,
        bookkeeperLogic.address,
        notifyHelper,
        mintHelperData[0],
        mintHelperData[2].address,
        rewardToken,
        psVault,
        vaultLogic.address,
        psEmptyStrategy,
        fundKeeperData[0],
        fundKeeperData[2].address,
        announcerData[0],
        announcerData[2].address
    );
  }

  public static async deployAndInitVaultAndStrategy<T>(
      vaultName: string,
      strategyDeployer: (vaultAddress: string) => Promise<IStrategy>,
      controller: Controller,
      vaultRewardToken: string,
      signer: SignerWithAddress,
      rewardDuration: number = 60 * 60 * 24 * 28, // 4 weeks
      wait = false
  ): Promise<any[]> {
    const vaultLogic = await DeployerUtils.deployContract(signer, "SmartVault");
    const vaultProxy = await DeployerUtils.deployContract(signer, "TetuProxyControlled", vaultLogic.address);
    const vault = vaultLogic.attach(vaultProxy.address) as SmartVault;

    const strategy = await strategyDeployer(vault.address);

    const strategyUnderlying = await strategy.underlying();

    await RunHelper.runAndWait(() => vault.initializeSmartVault(
        "TETU_" + vaultName,
        "x" + vaultName,
        controller.address,
        strategyUnderlying,
        rewardDuration
    ), true, wait);
    await RunHelper.runAndWait(() => vault.addRewardToken(vaultRewardToken), true, wait);

    await RunHelper.runAndWait(() => controller.addVaultAndStrategy(vault.address, strategy.address), true, wait);

    return [vaultLogic, vault, strategy];
  }

  // ************** VERIFY **********************

  public static async verify(address: string) {
    try {
      await hre.run("verify:verify", {
        address: address
      })
    } catch (e) {
      console.log('error verify', e);
    }
  }

  public static async verifyWithArgs(address: string, args: any[]) {
    try {
      await hre.run("verify:verify", {
        address: address, constructorArguments: args
      })
    } catch (e) {
      console.log('error verify', e);
    }
  }

  public static async verifyWithContractName(address: string, contractPath: string) {
    try {
      await hre.run("verify:verify", {
        address: address, contract: contractPath
      })
    } catch (e) {
      console.log('error verify', e);
    }
  }


  public static async verifyProxy(adr: string) {
    try {

      // const resp =
      await axios.post(
          (await DeployerUtils.getNetworkScanUrl()) +
          `?module=contract&action=verifyproxycontract&apikey=${Secrets.getNetworkScanKey()}`,
          `address=${adr}`);
      // console.log("proxy verify resp", resp);
    } catch (e) {
      console.log('error proxy verify', adr, e);
    }
  }

  // ************** ADDRESSES **********************

  public static async getNetworkScanUrl(): Promise<string> {
    const net = (await ethers.provider.getNetwork());
    if (net.name === 'ropsten') {
      return 'https://api-ropsten.etherscan.io/api';
    } else if (net.name === 'kovan') {
      return 'https://api-kovan.etherscan.io/api';
    } else if (net.name === 'rinkeby') {
      return 'https://api-rinkeby.etherscan.io/api';
    } else if (net.name === 'ethereum') {
      return 'https://api.etherscan.io/api';
    } else if (net.name === 'matic') {
      return 'https://api.polygonscan.com/api'
    } else if (net.chainId === 80001) {
      return 'https://api-testnet.polygonscan.com/api'
    } else {
      throw Error('network not found ' + net);
    }
  }

  public static async getCoreAddresses(): Promise<CoreAddresses> {
    const net = await ethers.provider.getNetwork();
    console.log('network', net.name);
    const core = Addresses.CORE.get(net.name);
    if (!core) {
      throw Error('No config for ' + net.name);
    }
    return core;
  }

  public static async getToolsAddresses(): Promise<ToolsAddresses> {
    const net = await ethers.provider.getNetwork();
    console.log('network', net.name);
    const tools = Addresses.TOOLS.get(net.name);
    if (!tools) {
      throw Error('No config for ' + net.name);
    }
    return tools;
  }

  public static async getTokenAddresses(): Promise<Map<string, string>> {
    const net = await ethers.provider.getNetwork();
    console.log('network', net.name);
    const mocks = Addresses.TOKENS.get(net.name);
    if (!mocks) {
      throw Error('No config for ' + net.name);
    }
    return mocks;
  }

  // ****************** WAIT ******************

  public static delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static async wait(blocks: number) {
    const start = ethers.provider.blockNumber;
    while (true) {
      console.log('wait 10sec');
      await DeployerUtils.delay(10000);
      if (ethers.provider.blockNumber >= start + blocks) {
        break;
      }
    }
  }


}
