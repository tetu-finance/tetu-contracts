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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./TetuSwapERC20.sol";
import "./libraries/UQ112x112.sol";
import "./libraries/Math.sol";
import "./libraries/TetuSwapLibrary.sol";
import "../third_party/uniswap/IUniswapV2Callee.sol";
import "../third_party/uniswap/IUniswapV2Factory.sol";
import "../third_party/IERC20Name.sol";
import "../base/interface/ISmartVault.sol";
import "./interfaces/ITetuSwapPair.sol";
import "../base/governance/Controllable.sol";

import "hardhat/console.sol";

/// @title Tetu swap pair based on Uniswap solution
/// @author belbix
contract TetuSwapPair is Controllable, TetuSwapERC20, ITetuSwapPair, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using UQ112x112 for uint224;

  // ********** CONSTANTS ********************
  uint public constant PRECISION = 10000;
  uint public constant MAX_FEE = 30;
  uint public constant override MINIMUM_LIQUIDITY = 10 ** 3;

  // ********** VARIABLES ********************
  address public override factory;
  address public override rewardRecipient;
  address public override token0;
  address public override token1;
  address public override vault0;
  address public override vault1;

  uint112 private shareReserve0;
  uint112 private shareReserve1;

  uint32 private blockTimestampLast; // uses single storage slot, accessible via getReserves
  uint public override price0CumulativeLast;
  uint public override price1CumulativeLast;
  string private _symbol;
  uint public override fee;

  // ********** EVENTS ********************

  event Mint(address indexed sender, uint amount0, uint amount1);
  event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
  event Swap(
    address indexed sender,
    uint amount0In,
    uint amount1In,
    uint amount0Out,
    uint amount1Out,
    address indexed to
  );
  event Sync(uint112 reserve0, uint112 reserve1);

  /// @dev Should be create only from factory
  constructor() {
    factory = msg.sender;
  }

  modifier onlyFactory() {
    require(msg.sender == factory, "TSP: Not factory");
    _;
  }

  /// @dev Called once by the factory at time of deployment
  function initialize(
    address _token0,
    address _token1,
    address _controller,
    uint _fee
  ) external override onlyFactory initializer {
    require(_fee <= MAX_FEE, "TSP: Too high fee");
    Controllable.initializeControllable(_controller);
    token0 = _token0;
    token1 = _token1;
    fee = _fee;
    _symbol = createPairSymbol(IERC20Name(_token0).symbol(), IERC20Name(_token1).symbol());
  }

  function symbol() external override view returns (string memory) {
    return _symbol;
  }

  function getReserves() public view override returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
    _reserve0 = vaultReserve0();
    _reserve1 = vaultReserve1();
    _blockTimestampLast = blockTimestampLast;
  }

  /// @dev Update reserves and, on the first call per block, price accumulators
  function _update() private {
    uint _shareBalance0 = IERC20(vault0).balanceOf(address(this));
    uint _shareBalance1 = IERC20(vault1).balanceOf(address(this));
    require(_shareBalance0 <= type(uint112).max && _shareBalance1 <= type(uint112).max, "TSP: OVERFLOW");

    uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
    uint32 timeElapsed = blockTimestamp - blockTimestampLast;

    if (timeElapsed > 0 && shareReserve0 != 0 && shareReserve1 != 0) {
      price0CumulativeLast += uint(UQ112x112.encode(shareReserve1).uqdiv(shareReserve0)) * timeElapsed;
      price1CumulativeLast += uint(UQ112x112.encode(shareReserve0).uqdiv(shareReserve1)) * timeElapsed;
    }

    shareReserve0 = uint112(_shareBalance0);
    shareReserve1 = uint112(_shareBalance1);
    blockTimestampLast = blockTimestamp;
    emit Sync(vaultReserve0(), vaultReserve1());
  }

  function mint(address to) external nonReentrant override returns (uint liquidity) {
    uint underlyingAmount0 = IERC20(token0).balanceOf(address(this));
    uint underlyingAmount1 = IERC20(token1).balanceOf(address(this));

    uint shareAmount0 = IERC20(vault0).balanceOf(address(this));
    uint shareAmount1 = IERC20(vault1).balanceOf(address(this));

    ISmartVault(vault0).deposit(underlyingAmount0);
    ISmartVault(vault1).deposit(underlyingAmount1);

    uint depositedAmount0 = IERC20(vault0).balanceOf(address(this)) - shareAmount0;
    uint depositedAmount1 = IERC20(vault1).balanceOf(address(this)) - shareAmount1;

    uint _totalSupply = totalSupply;
    if (_totalSupply == 0) {

      liquidity = Math.sqrt(depositedAmount0 * depositedAmount1) - MINIMUM_LIQUIDITY;
      _mint(address(0), MINIMUM_LIQUIDITY);
      // permanently lock the first MINIMUM_LIQUIDITY tokens
    } else {

      liquidity = Math.min(
        depositedAmount0 * _totalSupply / shareAmount0,
        depositedAmount1 * _totalSupply / shareAmount1
      );
    }

    require(liquidity > 0, "TSP: Insufficient liquidity minted");
    _mint(to, liquidity);

    _update();
    // reserve0 and reserve1 are up-to-date
    emit Mint(msg.sender, underlyingAmount0, underlyingAmount1);
  }

  function burn(address to) external nonReentrant override returns (uint amount0, uint amount1) {
    uint shareAmount0 = IERC20(vault0).balanceOf(address(this));
    uint shareAmount1 = IERC20(vault1).balanceOf(address(this));
    uint liquidity = balanceOf[address(this)];

    uint shareToWithdraw0 = liquidity * shareAmount0 / totalSupply;
    uint shareToWithdraw1 = liquidity * shareAmount1 / totalSupply;

    require(shareToWithdraw0 > 0 && shareToWithdraw1 > 0, "TSP: Insufficient liquidity burned");
    _burn(address(this), liquidity);

    require(shareToWithdraw0 <= IERC20(vault0).balanceOf(address(this)), "TSP: Insufficient shares 0");
    require(shareToWithdraw1 <= IERC20(vault1).balanceOf(address(this)), "TSP: Insufficient shares 0");

    ISmartVault(vault0).withdraw(shareToWithdraw0);
    ISmartVault(vault1).withdraw(shareToWithdraw1);

    amount0 = IERC20(token0).balanceOf(address(this));
    amount1 = IERC20(token1).balanceOf(address(this));

    IERC20(token0).safeTransfer(to, amount0);
    IERC20(token1).safeTransfer(to, amount1);

    _update();
    emit Burn(msg.sender, amount0, amount1, to);
  }

  /// @dev Assume tokenIn already sent to this contract
  function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external nonReentrant override {
    require(amount0Out > 0 || amount1Out > 0, "TSP: Insufficient output amount");
    (uint112 _reserve0, uint112 _reserve1,) = getReserves();
    require(amount0Out < _reserve0 && amount1Out < _reserve1, "TSP: Insufficient liquidity");

    uint expectedAmountIn0 = getAmountIn(amount1Out, _reserve0, _reserve1);
    uint expectedAmountIn1 = getAmountIn(amount0Out, _reserve1, _reserve0);

    // assume we invested all funds and have on balance only new tokens for current swap
    uint amount0In = IERC20(token0).balanceOf(address(this));
    uint amount1In = IERC20(token1).balanceOf(address(this));
    require(amount0In >= expectedAmountIn0 && amount1In >= expectedAmountIn1, "TSP: Insufficient input amount");

    if (amount0In > 0) {
      ISmartVault(vault0).deposit(amount0In);
    }
    if (amount1In > 0) {
      ISmartVault(vault1).deposit(amount1In);
    }

    _optimisticallyTransfer(amount0Out, amount1Out, to, data);

    // K value should be in healthy range
    {// scope for reserve{0,1}Adjusted, avoids stack too deep errors
      uint balance0 = vaultReserve0();
      uint balance1 = vaultReserve1();
      // check K without care about fees
      require(balance0 * balance1 >= uint(_reserve0) * uint(_reserve1), "TSP: K too low");
    }

    _update();
    emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
  }

  /// @dev Force update
  function sync() external nonReentrant override {
    _update();
  }

  // ******************************************************
  // ************ NON UNISWAP FUNCTIONS *******************
  // ******************************************************

  function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) public view returns (uint amountIn){
    if (amountOut == 0) {
      return 0;
    }
    return TetuSwapLibrary.getAmountIn(amountOut, reserveIn, reserveOut, fee);
  }

  function vaultReserve0() private view returns (uint112) {
    return uint112(ISmartVault(vault0).underlyingBalanceWithInvestmentForHolder(address(this)));
  }

  function vaultReserve1() private view returns (uint112){
    return uint112(ISmartVault(vault1).underlyingBalanceWithInvestmentForHolder(address(this)));
  }

  // ********* GOVERNANCE FUNCTIONS ****************

  function setFee(uint _fee) external override onlyFactory {
    require(_fee <= MAX_FEE, "TSP: Too high fee");
    fee = _fee;
  }

  /// @dev Called by fee setter after pair initialization
  function setVaults(address _vault0, address _vault1) external override onlyFactory {
    require(ISmartVault(_vault0).underlying() == token0, "TSP: Wrong vault0 underlying");
    require(ISmartVault(_vault1).underlying() == token1, "TSP: Wrong vault1 underlying");

    exitFromVault(vault0);
    exitFromVault(vault1);

    vault0 = _vault0;
    vault1 = _vault1;

    IERC20(token0).safeApprove(_vault0, type(uint).max);
    IERC20(token1).safeApprove(_vault1, type(uint).max);
  }

  function setRewardRecipient(address _recipient) external override onlyFactory {
    require(msg.sender == factory, "TSP: Not factory");
    rewardRecipient = _recipient;
  }

  function claimAll() external {
    require(rewardRecipient != address(0), "TSP: Zero reward recipient");
    require(msg.sender == ISmartVault(rewardRecipient).strategy(), "TSP: Only recipient strategy can claim");
    claim(vault0);
    claim(vault1);
  }

  // ***************** INTERNAL LOGIC ****************

  function _optimisticallyTransfer(uint amount0Out, uint amount1Out, address to, bytes calldata data) private {
    address _token0 = token0;
    address _token1 = token1;
    require(to != _token0 && to != _token1, "TSP: Invalid to");
    if (amount0Out > 0) {
      withdrawFromVault(vault0, amount0Out);
      IERC20(_token0).safeTransfer(to, amount0Out);
    }
    if (amount1Out > 0) {
      withdrawFromVault(vault1, amount1Out);
      IERC20(_token1).safeTransfer(to, amount1Out);
    }
    if (data.length > 0) {
      IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
    }
  }


  function exitFromVault(address _vault) private {
    if (_vault == address(0)) {
      return;
    }
    uint balance = IERC20(_vault).balanceOf(address(this));
    if (balance > 0) {
      ISmartVault(_vault).withdraw(balance);
    }
    IERC20(ISmartVault(_vault).underlying()).safeApprove(_vault, 0);
  }

  function withdrawFromVault(address _vault, uint _underlyingAmount) private {
    ISmartVault sv = ISmartVault(_vault);
    uint shareToWithdraw = _underlyingAmount * sv.underlyingUnit() / sv.getPricePerFullShare();
    require(shareToWithdraw <= IERC20(_vault).balanceOf(address(this)), "TSP: Insufficient shares");
    sv.withdraw(shareToWithdraw);
  }

  function createPairSymbol(string memory name0, string memory name1) private pure returns (string memory) {
    return string(abi.encodePacked("TLP_", name0, "_", name1));
  }

  function claim(address _vault) internal {
    require(_vault != address(0), "TSP: Zero vault");
    ISmartVault sv = ISmartVault(_vault);

    for (uint i = 0; i < sv.rewardTokensLength(); i++) {
      address rt = sv.rewardTokens()[i];
      uint bal = IERC20(rt).balanceOf(address(this));
      sv.getReward(rt);
      uint claimed = IERC20(rt).balanceOf(address(this)) - bal;

      ISmartVault(rewardRecipient).notifyTargetRewardAmount(rt, claimed);
    }
  }
}
