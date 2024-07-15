import {BigNumber, ContractFactory, ethers, providers, utils} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Libraries} from "hardhat-deploy/dist/types";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {formatUnits, parseUnits} from "ethers/lib/utils";

const log: Logger = new Logger(logSettings);

const libraries = new Map<string, string[]>([
  ['SmartVault', ['VaultLibrary',]],
  ['SmartVaultV110', ['VaultLibrary',]],
  ['ZapV2', ['ZapV2UniswapLibrary', 'ZapV2Balancer1Library', 'ZapV2Balancer2Library',]],
]);

export async function deployContract<T extends ContractFactory>(
  // tslint:disable-next-line
  hre: any,
  signer: SignerWithAddress,
  name: string,
  // tslint:disable-next-line:no-any
  ...args: any[]
) {
  await hre.run("compile")
  const web3 = hre.web3;
  const ethers = hre.ethers;
  log.info(`Deploying ${name}`);
  log.info("Account balance: " + utils.formatUnits(await signer.getBalance(), 18));

  let gasPrice = await web3.eth.getGasPrice();
  if (hre.network.name === 'custom') {
    gasPrice = BigNumber.from(1);
  }
  log.info("Gas price: " + formatUnits(gasPrice, 9));

  if (hre.network.name === 'eth') {
    while (true) {
      if (+formatUnits(gasPrice, 9) < 30) {
        break;
      } else {
        console.log('Wait for good gas price');
        await delay(60_000);
      }
      gasPrice = await web3.eth.getGasPrice();
      log.info("Gas price: " + formatUnits(gasPrice, 9));
    }
  }


  const libs: string[] | undefined = libraries.get(name);
  let _factory;
  if (libs) {
    const librariesObj: Libraries = {};
    for (const lib of libs) {
      log.info('DEPLOY LIBRARY', lib, 'for', name);
      librariesObj[lib] = (await deployContract(hre, signer, lib)).address;
    }

    _factory = (await ethers.getContractFactory(
      name,
      {
        signer,
        libraries: librariesObj
      }
    )) as T;
  } else {
    _factory = (await ethers.getContractFactory(
      name,
      signer
    )) as T;
  }
  const instance = await _factory.deploy(...args, {
    ...(await txParams(await ethers.provider.getFeeData(), hre.network.config.chainId))
  });
  log.info('Deploy tx:', instance.deployTransaction.hash);
  await instance.deployed();

  const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
  console.log('DEPLOYED: ', name, receipt.contractAddress);

  if (hre.network.name !== 'hardhat' && hre.network.name !== 'zktest') {
    await wait(hre, 10);
    if (args.length === 0) {
      await verify(hre, receipt.contractAddress);
    } else {
      await verifyWithArgs(hre, receipt.contractAddress, args);
    }
  }
  return _factory.attach(receipt.contractAddress);
}


// tslint:disable-next-line:no-any
async function wait(hre: any, blocks: number) {
  if (hre.network.name === 'hardhat') {
    return;
  }
  const start = hre.ethers.provider.blockNumber;
  while (true) {
    log.info('wait 10sec');
    await delay(10000);
    if (hre.ethers.provider.blockNumber >= start + blocks) {
      break;
    }
  }
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// tslint:disable-next-line:no-any
async function verify(hre: any, address: string) {
  try {
    await hre.run("verify:verify", {
      address
    })
  } catch (e) {
    log.info('error verify ' + e);
  }
}

// tslint:disable-next-line:no-any
async function verifyWithArgs(hre: any, address: string, args: any[]) {
  try {
    await hre.run("verify:verify", {
      address, constructorArguments: args
    })
  } catch (e) {
    log.info('error verify ' + e);
  }
}


async function txParams(feeData: ethers.providers.FeeData, networkId: number) {
  console.log('feeData', feeData, networkId);
  const gasPrice = '0x' + Math.floor((feeData.maxFeePerGas as BigNumber).toNumber() * 1.5).toString(16);
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.toNumber() ?? 0;
  // tslint:disable-next-line:no-any
  let result: any = {
    gasPrice
  }
  if (networkId === 137) {
    result = {
      maxPriorityFeePerGas: Math.max(maxPriorityFeePerGas, 31_000_000_000),
      maxFeePerGas: gasPrice,
    }
  } else if (networkId === 1) {
    result = {
      maxPriorityFeePerGas,
      maxFeePerGas: gasPrice
    }
  }
  console.log('TX params', result);
  return result;
}


