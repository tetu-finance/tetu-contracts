// SPDX-License-Identifier: ISC
/**
* By using this software, you understand, acknowledge and accept that Tetu
* and/or the underlying software are provided “as is” and “as available”
* basis and without warranties or representations of any kind either expressed
* or implied. Any use of this open source software released under the ISC
* Internet Systems Consortium license is done at your own risk to the fullest
* extent permissible pursuant to applicable law any and all liability as well
* as all warranties, including any fitness for a particular purpose with respect
* to Tetu and/or the underlying software and the use thereof are disclaimed.
*/

pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../../third_party/uniswap/IUniswapV2Pair.sol";
import "../../third_party/uniswap/IUniswapV2Router02.sol";
import "../price/IPriceCalculator.sol";
import "./PayrollClerkStorage.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Math.sol";
import "../../third_party/IERC20Extended.sol";

/// @title Disperse salary to workers
/// @author belbix
contract PayrollClerk is PayrollClerkStorage {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event WorkerRateUpdated(address indexed worker, uint256 value);
  event WorkerNameUpdated(address indexed worker, string value);
  event WorkerRoleUpdated(address indexed worker, string value);
  event TokenChanged(address[] tokens, uint256[] ratios);
  event SalaryPaid(address indexed worker, uint256 usdAmount, uint256 workedHours, uint256 rate);
  event TokenMoved(address token, uint256 amount);

  function initialize(address _controller, address _calculator) external initializer {
    require(_calculator != address(0), "zero calculator address");
    Controllable.initializeControllable(_controller);

    bytes32 slot = _CALCULATOR_SLOT;
    assembly {
      sstore(slot, _calculator)
    }
  }

  function allWorkers() external view returns (address[] memory) {
    return workers;
  }

  function workersLength() external view returns (uint256) {
    return workers.length;
  }

  function multiplePay(address[] calldata _workers, uint256[] calldata _workedHours)
  external onlyControllerOrGovernance {
    require(_workers.length == _workedHours.length, "wrong arrays");
    for (uint256 i = 0; i < _workers.length; i++) {
      pay(_workers[i], _workedHours[i]);
    }
  }

  function pay(address worker, uint256 _workedHours) public onlyControllerOrGovernance {
    require(baseHourlyRates[worker] != 0, "worker not registered");

    uint256 totalSalaryUsd;
    for (uint256 i = 0; i < tokens.length; i++) {
      (uint256 salaryUsd, uint256 salaryToken) = computeSalary(worker, _workedHours, tokens[i]);
      require(salaryToken <= IERC20(tokens[i]).balanceOf(address(this)), "not enough fund");
      IERC20(tokens[i]).safeTransfer(worker, salaryToken);
      totalSalaryUsd = totalSalaryUsd.add(salaryUsd);
    }
    workedHours[worker] = workedHours[worker].add(_workedHours);
    earned[worker] = earned[worker].add(totalSalaryUsd);
    emit SalaryPaid(worker, totalSalaryUsd, _workedHours, hourlyRate(worker));
  }

  function computeSalary(address worker, uint256 _workedHours, address token)
  public view returns (uint256 salaryUsd, uint256 salaryToken) {
    uint256 tPrice = IPriceCalculator(calculator()).getPriceWithDefaultOutput(token);
    uint256 hRate = hourlyRate(worker);
    salaryUsd = hRate.mul(_workedHours).mul(1e18)
    .mul(tokenRatios[token]).div(FULL_RATIO);

    // return token amount with token decimals
    salaryToken = salaryUsd.mul(1e18).div(tPrice)
    .mul(10 ** IERC20Extended(token).decimals()).div(1e18);
  }

  function hourlyRate(address worker) public view returns (uint256) {
    uint256 ratio = 1;
    if (boostActivated[worker]) {
      ratio = Math.min(workedHours[worker].div(BUST_STEP).add(1), MAX_BOOST);
    }
    return Math.min(baseHourlyRates[worker].mul(ratio), MAX_HOURLY_RATE);
  }

  /// if a wallet changed we need a way to migration
  function changeWorkerAddress(address oldWallet, address newWallet) external onlyControllerOrGovernance {
    uint256 idx = workerIndex(oldWallet);
    require(idx != type(uint256).max, "worker not registered");

    workerNames[newWallet] = workerNames[oldWallet];
    workerNames[oldWallet] = "";

    workerRoles[newWallet] = workerRoles[oldWallet];
    workerRoles[oldWallet] = "";

    baseHourlyRates[newWallet] = baseHourlyRates[oldWallet];
    baseHourlyRates[oldWallet] = 0;

    workedHours[newWallet] = workedHours[oldWallet];
    workedHours[oldWallet] = 0;

    earned[newWallet] = earned[oldWallet];
    earned[oldWallet] = 0;

    boostActivated[newWallet] = boostActivated[oldWallet];
    boostActivated[oldWallet] = false;

    workers[idx] = newWallet;
  }

  function addWorkers(
    address[] calldata _workers,
    uint256[] calldata rates,
    string[] calldata names,
    string[] calldata roles,
    bool[] calldata boosts
  )
  external onlyControllerOrGovernance {
    require(
      _workers.length == rates.length
      && _workers.length == names.length
      && _workers.length == roles.length
      && _workers.length == boosts.length
    , "wrong arrays");
    for (uint256 i = 0; i < _workers.length; i++) {
      addWorker(_workers[i], rates[i], names[i], roles[i], boosts[i]);
    }
  }

  function addWorker(
    address worker,
    uint256 rate,
    string calldata name,
    string calldata role,
    bool boost
  ) public onlyControllerOrGovernance {
    require(baseHourlyRates[worker] == 0, "worker already registered");
    workers.push(worker);
    setWorkerName(worker, name);
    setWorkerRole(worker, role);
    setBaseHourlyRate(worker, rate);
    boostActivated[worker] = boost;
  }

  function setWorkerName(address worker, string calldata name) public onlyControllerOrGovernance {
    require(bytes(name).length != 0, "empty name");
    require(bytes(name).length < 20, "too big name");
    workerNames[worker] = name;
    emit WorkerNameUpdated(worker, name);
  }

  function setWorkerRole(address worker, string calldata role) public onlyControllerOrGovernance {
    require(bytes(role).length != 0, "empty name");
    require(bytes(role).length < 20, "too big role");
    workerRoles[worker] = role;
    emit WorkerRoleUpdated(worker, role);
  }

  function setBaseHourlyRate(address worker, uint256 rate) public onlyControllerOrGovernance {
    require(rate != 0, "zero rate");
    require(rate <= MAX_HOURLY_RATE, "too high rate");
    baseHourlyRates[worker] = rate;
    emit WorkerRateUpdated(worker, rate);
  }

  function changeTokens(address[] calldata _tokens, uint256[] calldata ratios)
  external onlyControllerOrGovernance {
    require(_tokens.length == ratios.length, "wrong arrays");
    tokens = _tokens;

    for (uint i = 0; i < _tokens.length; i++) {
      tokenRatios[_tokens[i]] = ratios[i];
    }

    checkTokenRatios();
    emit TokenChanged(_tokens, ratios);
  }

  function switchBoost(address worker, bool active) external onlyControllerOrGovernance {
    require(baseHourlyRates[worker] != 0, "worker not registered");
    boostActivated[worker] = active;
  }

  function checkTokenRatios() internal view {
    uint256 sum;
    for (uint256 i = 0; i < tokens.length; i++) {
      sum = sum.add(tokenRatios[tokens[i]]);
    }
    require(sum == FULL_RATIO, "invalid token ratios");
  }

  function workerIndex(address worker) public view returns (uint256){
    for (uint256 i = 0; i < workers.length; i++) {
      if (workers[i] == worker) {
        return i;
      }
    }
    return type(uint256).max;
  }

  /// @dev Move tokens to governance
  ///      This contract should contain only governance funds
  function moveTokensToGovernance(address _token, uint256 amount) external onlyControllerOrGovernance {
    uint256 tokenBalance = IERC20(_token).balanceOf(address(this));
    require(tokenBalance >= amount, "not enough balance");
    IERC20(_token).safeTransfer(IController(controller()).governance(), amount);
    emit TokenMoved(_token, amount);
  }

}
