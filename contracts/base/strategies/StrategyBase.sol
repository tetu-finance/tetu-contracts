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
import "../interface/IStrategy.sol";
import "../governance/Controllable.sol";
import "../interface/IFeeRewardForwarder.sol";
import "../interface/IBookkeeper.sol";

/// @title Abstract contract for base strategy functionality
/// @author belbix
abstract contract StrategyBase is IStrategy, Controllable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  //************************ VARIABLES **************************
  address internal _underlyingToken;
  address internal _smartVault;
  mapping(address => bool) internal _unsalvageableTokens;
  /// @dev we always use 100% buybacks but keep this variable to further possible changes
  uint256 internal _buyBackRatio;
  /// @dev When this flag is true, the strategy will not be able to invest. But users should be able to withdraw.
  bool public override pausedInvesting = false;
  address[] internal _rewardTokens;


  //************************ MODIFIERS **************************

  /// @dev Only for linked Vault or Governance/Controller.
  ///      Use for functions that should have strict access.
  modifier restricted() {
    require(msg.sender == _smartVault
    || msg.sender == address(controller())
      || isGovernance(msg.sender),
      "forbidden");
    _;
  }

  /// @dev This is only used in `investAllUnderlying()`
  ///      The user can still freely withdraw from the strategy
  modifier onlyNotPausedInvesting() {
    require(!pausedInvesting, "paused");
    _;
  }

  /// @notice Contract constructor using on Base Strategy implementation
  /// @param _controller Controller address
  /// @param _underlying Underlying token address
  /// @param _vault SmartVault address that will provide liquidity
  /// @param __rewardTokens Reward tokens that the strategy will farm
  /// @param _bbRatio Buy back ratio
  constructor(
    address _controller,
    address _underlying,
    address _vault,
    address[] memory __rewardTokens,
    uint256 _bbRatio
  ) {
    Controllable.initializeControllable(_controller);
    _underlyingToken = _underlying;
    _smartVault = _vault;
    _rewardTokens = __rewardTokens;
    _buyBackRatio = _bbRatio;

    // prohibit the movement of tokens that are used in the main logic
    for (uint256 i = 0; i < _rewardTokens.length; i++) {
      _unsalvageableTokens[_rewardTokens[i]] = true;
    }
    _unsalvageableTokens[_underlying] = true;
  }

  // *************** VIEWS ****************

  /// @notice Reward tokens of external project
  /// @return Reward tokens array
  function rewardTokens() public view override returns (address[] memory) {
    return _rewardTokens;
  }

  /// @notice Strategy underlying, the same in the Vault
  /// @return Strategy underlying token
  function underlying() external view override returns (address) {
    return _underlyingToken;
  }

  /// @notice Underlying balance of this contract
  /// @return Balance of underlying token
  function underlyingBalance() public view override returns (uint256) {
    return IERC20(_underlyingToken).balanceOf(address(this));
  }

  /// @notice SmartVault address linked to this strategy
  /// @return Vault address
  function vault() external view override returns (address) {
    return _smartVault;
  }

  /// @notice Return true for tokens that governance can't touch
  /// @return True if given token unsalvageable
  function unsalvageableTokens(address token) external override view returns (bool) {
    return _unsalvageableTokens[token];
  }

  /// @notice Strategy buy back ratio. Currently stubbed to 100%
  /// @return Buy back ratio
  function buyBackRatio() external view override returns (uint256) {
    return _buyBackRatio;
  }

  /// @notice Balance of given token on this contract
  /// @return Balance of given token
  function rewardBalance(uint256 rewardTokenIdx) public view returns (uint256) {
    return IERC20(_rewardTokens[rewardTokenIdx]).balanceOf(address(this));
  }

  /// @notice Return underlying balance + balance in the reward pool
  /// @return Sum of underlying balances
  function investedUnderlyingBalance() external override view returns (uint256) {
    // Adding the amount locked in the reward pool and the amount that is somehow in this contract
    // both are in the units of "underlying"
    // The second part is needed because there is the emergency exit mechanism
    // which would break the assumption that all the funds are always inside of the reward pool
    return rewardPoolBalance().add(underlyingBalance());
  }

  //******************** GOVERNANCE *******************


  /// @notice In case there are some issues discovered about the pool or underlying asset
  ///         Governance can exit the pool properly
  ///         The function is only used for emergency to exit the pool
  ///         Pause investing
  function emergencyExit() external override onlyControllerOrGovernance {
    emergencyExitRewardPool();
    pausedInvesting = true;
  }


  /// @notice Resumes the ability to invest into the underlying reward pools
  function continueInvesting() external override onlyControllerOrGovernance {
    pausedInvesting = false;
  }

  /// @notice Controller can claim coins that are somehow transferred into the contract
  ///         Note that they cannot come in take away coins that are used and defined in the strategy itself
  /// @param recipient Recipient address
  /// @param recipient Token address
  /// @param recipient Token amount
  function salvage(address recipient, address token, uint256 amount)
  external override onlyController {
    // To make sure that governance cannot come in and take away the coins
    require(!_unsalvageableTokens[token], "not salvageable");
    IERC20(token).safeTransfer(recipient, amount);
  }

  /// @notice Withdraws all the asset to the vault
  function withdrawAllToVault() external override restricted {
    exitRewardPool();
    IERC20(_underlyingToken).safeTransfer(_smartVault, underlyingBalance());
  }

  /// @notice Withdraws some asset to the vault
  /// @param amount Asset amount
  function withdrawToVault(uint256 amount) external override restricted {
    // Typically there wouldn't be any amount here
    // however, it is possible because of the emergencyExit
    if (amount > underlyingBalance()) {
      // While we have the check above, we still using SafeMath below
      // for the peace of mind (in case something gets changed in between)
      uint256 needToWithdraw = amount.sub(underlyingBalance());
      uint256 toWithdraw = Math.min(rewardPoolBalance(), needToWithdraw);
      withdrawAndClaimFromPool(toWithdraw);
    }

    IERC20(_underlyingToken).safeTransfer(_smartVault, Math.min(amount, underlyingBalance()));
  }

  /// @notice Stakes everything the strategy holds into the reward pool
  function investAllUnderlying() public override restricted onlyNotPausedInvesting {
    // this check is needed, because most of the SNX reward pools will revert if
    // you try to stake(0).
    if (underlyingBalance() > 0) {
      depositToPool(underlyingBalance());
    }
  }

  // ***************** INTERNAL ************************

  /// @dev Withdraw everything from external pool
  function exitRewardPool() internal virtual {
    uint256 bal = rewardPoolBalance();
    if (bal != 0) {
      withdrawAndClaimFromPool(bal);
    }
  }

  /// @dev Withdraw everything from external pool without caring about rewards
  function emergencyExitRewardPool() internal {
    uint256 bal = rewardPoolBalance();
    if (bal != 0) {
      emergencyWithdrawFromPool();
    }
  }

  /// @dev Default implementation of liquidation process
  ///      Send all profit to FeeRewardForwarder
  function liquidateRewardDefault() internal {
    address forwarder = IController(controller()).feeRewardForwarder();
    for (uint256 i = 0; i < _rewardTokens.length; i++) {
      uint256 amount = rewardBalance(i);
      if (amount != 0) {
        address rt = _rewardTokens[i];
        IERC20(rt).safeApprove(forwarder, 0);
        IERC20(rt).safeApprove(forwarder, amount);
        // it will sell reward token to Target Token and distribute it to SmartVault and PS
        uint256 targetTokenEarned = IFeeRewardForwarder(forwarder).distribute(amount, rt, _smartVault);
        if (targetTokenEarned > 0) {
          IBookkeeper(IController(controller()).bookkeeper()).registerStrategyEarned(targetTokenEarned);
        }
      }
    }
  }

  //******************** VIRTUAL *********************
  // This functions should be implemented in the strategy contract

  function rewardPoolBalance() public virtual override view returns (uint256 bal);

  //slither-disable-next-line dead-code
  function depositToPool(uint256 amount) internal virtual;

  //slither-disable-next-line dead-code
  function withdrawAndClaimFromPool(uint256 amount) internal virtual;

  //slither-disable-next-line dead-code
  function emergencyWithdrawFromPool() internal virtual;

  //slither-disable-next-line dead-code
  function liquidateReward() internal virtual;

}
