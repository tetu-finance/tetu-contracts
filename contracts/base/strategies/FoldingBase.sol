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

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./StrategyBase.sol";
import "../interface/ISmartVault.sol";
import "../../third_party/IERC20Extended.sol";

/// @title Abstract contract for folding strategy
/// @author JasperS13
/// @author belbix
abstract contract FoldingBase is StrategyBase {
  using SafeERC20 for IERC20;

  // ************ VARIABLES **********************
  /// @dev Maximum folding loops
  uint256 public constant MAX_DEPTH = 20;
  /// @notice Denominator value for the both above mentioned ratios
  uint256 public _FACTOR_DENOMINATOR = 10000;

  /// @notice Numerator value for the targeted borrow rate
  uint256 public borrowTargetFactorNumeratorStored;
  uint256 public borrowTargetFactorNumerator;
  /// @notice Numerator value for the asset market collateral value
  uint256 public collateralFactorNumerator;
  /// @notice Use folding
  bool public fold = true;

  /// @notice Strategy balance parameters to be tracked
  uint256 public suppliedInUnderlying;
  uint256 public borrowedInUnderlying;

  event FoldChanged(bool value);
  event FoldStopped();
  event FoldStarted(uint256 borrowTargetFactorNumerator);
  event MaxDepthReached();
  event NoMoneyForLiquidateUnderlying();
  event UnderlyingLiquidationFailed();
  event Rebalanced(uint256 supplied, uint256 borrowed, uint256 borrowTarget);
  event BorrowTargetFactorNumeratorChanged(uint256 value);
  event CollateralFactorNumeratorChanged(uint256 value);

  modifier updateSupplyInTheEnd() {
    _;
    (suppliedInUnderlying, borrowedInUnderlying) = _getInvestmentData();
  }

  constructor(
    address _controller,
    address _underlying,
    address _vault,
    address[] memory __rewardTokens,
    uint256 __buyBackRatio,
    uint256 _borrowTargetFactorNumerator,
    uint256 _collateralFactorNumerator
  ) StrategyBase(_controller, _underlying, _vault, __rewardTokens, __buyBackRatio) {
    require(_collateralFactorNumerator < _FACTOR_DENOMINATOR, "FS: Collateral factor cannot be this high");
    collateralFactorNumerator = _collateralFactorNumerator;

    require(_borrowTargetFactorNumerator < collateralFactorNumerator, "FS: Target should be lower than collateral limit");
    borrowTargetFactorNumeratorStored = _borrowTargetFactorNumerator;
    borrowTargetFactorNumerator = _borrowTargetFactorNumerator;
  }

  ///////////// internal functions require specific implementation for each platforms

  function _getInvestmentData() internal virtual returns (uint256 supplied, uint256 borrowed);

  function _isFoldingProfitable() internal view virtual returns (bool);

  function _claimReward() internal virtual;

  //////////// require update balance in the end

  function _supply(uint256 amount) internal virtual;

  function _borrow(uint256 amountUnderlying) internal virtual;

  function _redeemUnderlying(uint256 amountUnderlying) internal virtual;

  function _redeemLoanToken(uint256 amount) internal virtual;

  function _repay(uint256 amountUnderlying) internal virtual;

  function _redeemMaximumWithLoan() internal virtual;

  // ************* VIEW **********************

  /// @dev Return true if we can gain profit with folding
  function isFoldingProfitable() public view returns (bool) {
    return _isFoldingProfitable();
  }

  function _borrowTarget() internal returns (uint256) {
    (uint256 supplied, uint256 borrowed) = _getInvestmentData();
    uint256 balance = supplied - borrowed;
    return balance * borrowTargetFactorNumerator
    / (_FACTOR_DENOMINATOR - borrowTargetFactorNumerator);
  }

  // ************* GOV ACTIONS **************

  /// @dev Set use folding
  function setFold(bool _fold) public restricted {
    _setFold(_fold);
  }

  /// @dev Rebalances the borrow ratio
  function rebalance() public restricted {
    _rebalance();
  }

  /// @dev Set borrow rate target
  function setBorrowTargetFactorNumeratorStored(uint256 _target) public restricted {
    _setBorrowTargetFactorNumeratorStored(_target);
  }

  function stopFolding() public restricted {
    _stopFolding();
  }

  function startFolding() public restricted {
    _startFolding();
  }

  /// @dev Set collateral rate for asset market
  function setCollateralFactorNumerator(uint256 _target) external restricted {
    require(_target < _FACTOR_DENOMINATOR, "FS: Collateral factor cannot be this high");
    collateralFactorNumerator = _target;
    emit CollateralFactorNumeratorChanged(_target);
  }

  //////////////////////////////////////////////////////
  //////////// STRATEGY FUNCTIONS IMPLEMENTATIONS //////
  //////////////////////////////////////////////////////

  /// @notice Strategy balance supplied minus borrowed
  /// @return bal Balance amount in underlying tokens
  function rewardPoolBalance() public override view returns (uint256) {
    return suppliedInUnderlying - borrowedInUnderlying;
  }

  /// @notice Claim rewards from external project and send them to FeeRewardForwarder
  function doHardWork() external onlyNotPausedInvesting override restricted {
    _claimReward();
    _compound();
    liquidateReward();
    investAllUnderlying();
    if (!isFoldingProfitable() && fold) {
      stopFolding();
    } else if (isFoldingProfitable() && !fold) {
      startFolding();
    } else {
      rebalance();
    }
  }

  /// @dev Withdraw underlying from Iron MasterChef finance
  /// @param amount Withdraw amount
  function withdrawAndClaimFromPool(uint256 amount) internal override updateSupplyInTheEnd {
    _claimReward();
    _redeemPartialWithLoan(amount);
  }

  /// @dev Exit from external project without caring about rewards
  ///      For emergency cases only!
  function emergencyWithdrawFromPool() internal override updateSupplyInTheEnd {
    _redeemMaximumWithLoan();
  }

  /// @dev Should withdraw all available assets
  function exitRewardPool() internal override updateSupplyInTheEnd {
    uint256 bal = rewardPoolBalance();
    if (bal != 0) {
      _claimReward();
      _redeemMaximumWithLoan();
      // reward liquidation can ruin transaction, do it in hard work process
    }
  }

  //////////////////////////////////////////////////////
  //////////// INTERNAL GOV FUNCTIONS //////////////////
  //////////////////////////////////////////////////////

  /// @dev Rebalances the borrow ratio
  function _rebalance() internal updateSupplyInTheEnd {
    (uint256 supplied, uint256 borrowed) = _getInvestmentData();
    uint256 borrowTarget = _borrowTarget();
    if (borrowed > borrowTarget) {
      _redeemPartialWithLoan(0);
    } else if (borrowed < borrowTarget) {
      depositToPool(0);
    }
    emit Rebalanced(supplied, borrowed, borrowTarget);
  }

  /// @dev Set use folding
  function _setFold(bool _fold) internal {
    fold = _fold;
    emit FoldChanged(_fold);
  }

  /// @dev Set borrow rate target
  function _setBorrowTargetFactorNumeratorStored(uint256 _target) internal {
    require(_target < collateralFactorNumerator, "FS: Target should be lower than collateral limit");
    borrowTargetFactorNumeratorStored = _target;
    if (fold) {
      borrowTargetFactorNumerator = _target;
    }
    emit BorrowTargetFactorNumeratorChanged(_target);
  }

  function _stopFolding() internal {
    borrowTargetFactorNumerator = 0;
    _setFold(false);
    _rebalance();
    emit FoldStopped();
  }

  function _startFolding() internal {
    borrowTargetFactorNumerator = borrowTargetFactorNumeratorStored;
    _setFold(true);
    _rebalance();
    emit FoldStarted(borrowTargetFactorNumeratorStored);
  }

  //////////////////////////////////////////////////////
  //////////// FOLDING LOGIC FUNCTIONS /////////////////
  //////////////////////////////////////////////////////

  /// @dev Deposit underlying to rToken contract
  /// @param amount Deposit amount
  function depositToPool(uint256 amount) internal override updateSupplyInTheEnd {
    if (amount > 0) {
      // we need to sell excess in non hardWork function for keeping ppfs ~1
      _liquidateExcessUnderlying();
      _supply(amount);
    }
    if (!fold || !isFoldingProfitable()) {
      return;
    }
    (uint256 supplied, uint256 borrowed) = _getInvestmentData();
    uint256 borrowTarget = _borrowTarget();
    uint256 i = 0;
    while (borrowed < borrowTarget) {
      uint256 wantBorrow = borrowTarget - borrowed;
      uint256 maxBorrow = (supplied * collateralFactorNumerator / _FACTOR_DENOMINATOR) - borrowed;
      _borrow(Math.min(wantBorrow, maxBorrow));
      uint256 underlyingBalance = IERC20(_underlyingToken).balanceOf(address(this));
      if (underlyingBalance > 0) {
        _supply(underlyingBalance);
      }

      // need to update local balances
      (supplied, borrowed) = _getInvestmentData();
      i++;
      if (i == MAX_DEPTH) {
        emit MaxDepthReached();
        break;
      }
    }
  }

  /// @dev Redeems a set amount of underlying tokens while keeping the borrow ratio healthy.
  ///      This function must nor revert transaction
  function _redeemPartialWithLoan(uint256 amount) internal updateSupplyInTheEnd {
    (uint256 supplied, uint256 borrowed) = _getInvestmentData();
    uint256 oldBalance = supplied - borrowed;
    uint256 newBalance = 0;
    if (amount < oldBalance) {
      newBalance = oldBalance - amount;
    }
    uint256 newBorrowTarget = newBalance * borrowTargetFactorNumerator / (_FACTOR_DENOMINATOR - borrowTargetFactorNumerator);
    uint256 underlyingBalance = 0;
    uint256 i = 0;
    while (borrowed > newBorrowTarget) {
      uint256 requiredCollateral = borrowed * _FACTOR_DENOMINATOR / collateralFactorNumerator;
      uint256 toRepay = borrowed - newBorrowTarget;
      if (supplied < requiredCollateral) {
        break;
      }
      // redeem just as much as needed to repay the loan
      // supplied - requiredCollateral = max redeemable, amount + repay = needed
      uint256 toRedeem = Math.min(supplied - requiredCollateral, amount + toRepay);
      _redeemUnderlying(toRedeem);
      // now we can repay our borrowed amount
      underlyingBalance = IERC20(_underlyingToken).balanceOf(address(this));
      toRepay = Math.min(toRepay, underlyingBalance);
      if (toRepay == 0) {
        // in case of we don't have money for repaying we can't do anything
        break;
      }
      _repay(toRepay);
      // update the parameters
      (supplied, borrowed) = _getInvestmentData();
      i++;
      if (i == MAX_DEPTH) {
        emit MaxDepthReached();
        break;
      }
    }
    underlyingBalance = IERC20(_underlyingToken).balanceOf(address(this));
    if (underlyingBalance < amount) {
      uint256 toRedeem = amount - underlyingBalance;
      // redeem the most we can redeem
      _redeemUnderlying(toRedeem);
    }
  }

  //////////////////////////////////////////////////////
  ///////////////// LIQUIDATION ////////////////////////
  //////////////////////////////////////////////////////

  function _compound() internal {
    (suppliedInUnderlying, borrowedInUnderlying) = _getInvestmentData();
    uint256 ppfs = ISmartVault(_smartVault).getPricePerFullShare();
    uint256 ppfsPeg = ISmartVault(_smartVault).underlyingUnit();

    // in case of negative ppfs compound all profit to underlying
    if (ppfs < ppfsPeg) {
      for (uint256 i = 0; i < _rewardTokens.length; i++) {
        uint256 amount = rewardBalance(i);
        address rt = _rewardTokens[i];
        // it will sell reward token to Target Token and send back
        if (amount != 0) {
          address forwarder = IController(controller()).feeRewardForwarder();
          // keep a bit for for distributing for catch all necessary events
          amount = amount * 90 / 100;
          IERC20(rt).safeApprove(forwarder, 0);
          IERC20(rt).safeApprove(forwarder, amount);
          uint256 underlyingProfit = IFeeRewardForwarder(forwarder).liquidate(rt, _underlyingToken, amount);
          // supply profit for correct ppfs calculation
          if (underlyingProfit != 0) {
            _supply(underlyingProfit);
          }
        }
      }
      // safe way to keep ppfs peg is sell excess after reward liquidation
      // it should not decrease old ppfs
      _liquidateExcessUnderlying();
    }
  }

  /// @dev We should keep PPFS ~1
  ///      This function must not ruin transaction
  function _liquidateExcessUnderlying() internal updateSupplyInTheEnd {
    // update balances for accurate ppfs calculation
    (suppliedInUnderlying, borrowedInUnderlying) = _getInvestmentData();

    address forwarder = IController(controller()).feeRewardForwarder();
    uint256 ppfs = ISmartVault(_smartVault).getPricePerFullShare();
    uint256 ppfsPeg = ISmartVault(_smartVault).underlyingUnit();

    if (ppfs > ppfsPeg) {
      uint256 totalUnderlyingBalance = ISmartVault(_smartVault).underlyingBalanceWithInvestment();
      if (totalUnderlyingBalance == 0
      || IERC20Extended(_smartVault).totalSupply() == 0
      || totalUnderlyingBalance < IERC20Extended(_smartVault).totalSupply()
        || totalUnderlyingBalance - IERC20Extended(_smartVault).totalSupply() < 2) {
        // no actions in case of no money
        emit NoMoneyForLiquidateUnderlying();
        return;
      }
      // ppfs = 1 if underlying balance = total supply
      // -1 for avoiding problem with rounding
      uint256 toLiquidate = (totalUnderlyingBalance - IERC20Extended(_smartVault).totalSupply()) - 1;
      if (underlyingBalance() < toLiquidate) {
        _redeemPartialWithLoan(toLiquidate - underlyingBalance());
      }
      toLiquidate = Math.min(underlyingBalance(), toLiquidate);
      if (toLiquidate != 0) {
        IERC20(_underlyingToken).safeApprove(forwarder, 0);
        IERC20(_underlyingToken).safeApprove(forwarder, toLiquidate);

        // it will sell reward token to Target Token and distribute it to SmartVault and PS
        // we must not ruin transaction in any case
        //slither-disable-next-line unused-return,variable-scope,uninitialized-local
        try IFeeRewardForwarder(forwarder).distribute(toLiquidate, _underlyingToken, _smartVault)
        returns (uint256 targetTokenEarned) {
          if (targetTokenEarned > 0) {
            IBookkeeper(IController(controller()).bookkeeper()).registerStrategyEarned(targetTokenEarned);
          }
        } catch {
          emit UnderlyingLiquidationFailed();
        }
      }
    }
  }

  receive() external payable {} // this is needed for the native token unwrapping
}