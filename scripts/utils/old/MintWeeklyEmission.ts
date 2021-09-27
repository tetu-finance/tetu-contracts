import {ethers} from "hardhat";
import {DeployerUtils} from "../../deploy/DeployerUtils";
import {Announcer, Controller, RewardToken} from "../../../typechain";
import {RunHelper} from "../RunHelper";


async function main() {
  const core = await DeployerUtils.getCoreAddresses();
  const signer = (await ethers.getSigners())[0];
  const token = await DeployerUtils.connectContract(
      signer, "RewardToken", core.rewardToken) as RewardToken;
  const announcer = await DeployerUtils.connectContract(signer, "Announcer", core.announcer) as Announcer;
  const week = (await token.currentWeek()).toNumber();
  console.log('current week', week);

  const annIdx = await announcer.timeLockIndexes('16');

  if (annIdx.isZero()) {
    console.log('Announce Mint');
    // let toMint = (await token.maxTotalSupplyForCurrentBlock()).sub(await token.totalSupply());
    // if (toMint.isZero()) {
    //   // first week
    //   toMint = utils.parseUnits('129746126');
    // }

    // console.log('To mint', utils.formatUnits(toMint, 18));
    await RunHelper.runAndWait(() => announcer.announceMint(0, core.notifyHelper, core.fundKeeper, true));
  } else {
    console.log('Mint announced', annIdx)
    const controller = await DeployerUtils.connectContract(signer, "Controller", core.controller) as Controller;

    const annInfo = await announcer.timeLockInfo(annIdx);
    console.log('annInfo', annInfo);

    if (annInfo.opCode != 16) {
      throw Error('Wrong opcode!');
    }

    const ts = (await announcer.timeLockSchedule(annInfo.opHash)).toNumber();
    console.log('ts', ts, new Date(ts * 1000), Date.now() / 1000);

    if (Date.now() / 1000 < ts) {
      console.log('not yet', (ts - (Date.now() / 1000)) / 60 / 60)
      return;
    }

    const amount = annInfo.numValues[0];
    const distributor = annInfo.adrValues[0];
    const fund = annInfo.adrValues[1];
    return;
    // await RunHelper.runAndWait(() => controller.mintAndDistribute(0, distributor, fund, true));

  }
}

main()
.then(() => process.exit(0))
.catch(error => {
  console.error(error);
  process.exit(1);
});
