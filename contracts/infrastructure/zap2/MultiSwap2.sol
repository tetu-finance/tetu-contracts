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

import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/ReentrancyGuard.sol";
import "../../base/governance/ControllableV2.sol";
import "../../swap/interfaces/ITetuSwapPair.sol";
//import "../../third_party/uniswap/IUniswapV2Factory.sol";
import "../../third_party/uniswap/IUniswapV2Pair.sol";
import "../../third_party/uniswap/IUniswapV2Router02.sol";
import "../../third_party/balancer/IBVault.sol";
import "../../third_party/IERC20Name.sol"; // TODO remove
import "../../base/SlotsLib.sol";
import "./IMultiSwap2.sol";

import "hardhat/console.sol";

/// @title MultiSwapLoader
/// @dev Multi Swap Data Loader
/// @author bogdoslav
contract MultiSwap2 is IMultiSwap2, ControllableV2, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using SlotsLib for bytes32;

//  string public constant VERSION = "1.0.0";
//  uint public constant MAX_AMOUNT = type(uint).max;
//  uint128 constant private _PRECISION_FEE = 10000;
//  uint128 constant private _PRECISION_SLIPPAGE = 1000;
//  bytes32 private constant _UNISWAP_MASK = "0xfffffffffffffffffffffff0"; // last half-byte - index of uniswap dex
//  bytes32 internal constant _WETH_SLOT = bytes32(uint256(keccak256("eip1967.MultiSwap2.weth")) - 1);

  // Sentinel value used to indicate WETH with wrapping/unwrapping semantics. The zero address is a good choice for
  // multiple reasons: it is cheap to pass as a calldata argument, it is a known invalid token and non-contract, and
  // it is an address Pools cannot register as a token.
//  address private constant _ETH = address(0);

  function initialize(address controller_, address weth_)
  public initializer {
//    ControllableV2.initializeControllable(controller_);
//    _WETH_SLOT.set(weth_);
  }

  // ******* VIEWS ******


  // ******************** USERS ACTIONS *********************
  struct SwapData {
    address tokenIn;
    address tokenOut;
    uint amount;
    uint minAmountOut;
    uint256 deadline;
  }

  function multiSwap(
    SwapData memory swapData,
    IBVault.BatchSwapStep[] memory swaps,
    IAsset[] memory assets
  )
    external
    nonReentrant
    returns (uint amountOut)
  {
        require(tokenIn != address(0), "MS: zero tokenIn");
        require(tokenOut != address(0), "MS: zero tokenOut");
        require(amount != 0, "MS: zero amount");
        require(swaps[0].amount > 0, 'MS: Unknown amount in first swap');
        require(tokenIn != tokenOut, "MS: same in/out");

        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "MS: deadline");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amount);
        // some tokens have a burn/fee mechanic for transfers so amount can be changed
        // we are recommend to use manual swapping for this kind of tokens
        require(IERC20(tokenIn).balanceOf(address(this)) >= amount,
          "MS: transfer fees forbidden for input Token");


        IBVault.FundManagement memory funds = FundManagement({
          sender: address(this),
          fromInternalBalance: false,
          recipient: address(this),
          toInternalBalance: false
        });

      uint amountOutBefore = IERC20(tokenOut).balanceOf(address(this));

      // These variables could be declared inside the loop, but that causes the compiler to allocate memory on each
      // loop iteration, increasing gas costs.
      IBVault.BatchSwapStep memory swapStep;

      // These store data about the previous swap here to implement multihop logic across swaps.
      IERC20 previousTokenOut = IERC20(tokenIn);
      uint256 previousAmountOut = amount;

      uint len = swaps.length;
      for (uint i = 0; i < len; i++) {
        swapStep = swaps[i];

        IERC20 swapTokenIn = _translateToIERC20(assets[swapStep.assetInIndex]);
        IERC20 swapTokenOut = _translateToIERC20(assets[swapStep.assetOutIndex]);

        uint swapAmount;
        if (swapStep.amount == 0) {
          require(previousTokenOut == swapTokenIn, 'MS: Malconstructed multi swap');
          require(previousAmountOut > 0, 'MS: Unknown amount in swap');
          swapAmount = previousAmountOut;
        } else {
          swapAmount = swapStep.amount;
        }

        if (_isUniswapPool(swapStep.poolId)) {
          previousAmountOut = _swapUniswap(swapStep, swapTokenIn, swapTokenOut, swapAmount);
        } else { // Suppose Balancer pool // TODO
          previousAmountOut = _swapBalancer(swapStep, swapTokenIn, swapTokenOut, swapAmount);
        }
        previousTokenOut = swapTokenOut;
      }

      amountOut = IERC20(tokenOut).balanceOf(address(this)) - amountOutBefore;
      require(amountOut >= minAmountOut, "MS: amount out less than required");

      IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
      require(amountOut <= IERC20(tokenOut).balanceOf(msg.sender),
        "MS: transfer fees forbidden for output Token");
  }


  // ******************* INTERNAL ***************************

  /**
   * @dev Returns the address of a Pool's contract.
   *
   * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
   */
  function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
    // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
    // since the logical shift already sets the upper bits to zero.
    return address(uint160(uint256(poolId) >> (12 * 8)));
  }

  function _isUniswapPool(bytes32 poolId) internal pure returns (bool) {
    return (poolId & _UNISWAP_MASK) == _UNISWAP_MASK;
  }

  function _swapUniswap(
    IBVault.BatchSwapStep memory swapStep,
    IERC20 tokenIn,
    IERC20 tokenOut,
    uint swapAmount
  )
  internal returns (uint amountOut) {
    IUniswapV2Pair pair = IUniswapV2Pair(_getPoolAddress(swapStep.poolId));

    address token0 = pair.token0();
    address token1 = pair.token1();

    require(
      (token0 == address(tokenIn) && token1 == address(tokenOut)) ||
      (token1 == address(tokenIn) && token0 == address(tokenOut)),
      'MS: Wrong tokens'
    );

    IERC20(tokenIn).safeTransfer(address(pair), swapAmount);

    bool reverse = address(tokenIn) == token1;
    (uint amountOut0, uint amountOut1) = _getAmountsOut(pair, swapAmount, reverse);
    pair.swap(amountOut0, amountOut1, address(this), swapStep.userData);
    amountOut = reverse ? amountOut0 : amountOut1;
  }

  function _swapBalancer(
    IBVault.BatchSwapStep memory swapStep,
    IERC20 tokenIn,
    IERC20 tokenOut,
    uint swapAmount
  )
  internal returns (uint amountOut) {
    amountOut = 0; // TODO
  }


  //TODO remove obsolete
  function _doSwapStepUniswap2(Step memory step, uint amountIn)
  internal {
    IUniswapV2Pair pair = IUniswapV2Pair(step.lp);
    console.log(' ');
    if (amountIn == MAX_AMOUNT)
      console.log('swap', step.lp, step.reverse, 'MAX');
    else
      console.log('swap', step.lp, step.reverse, amountIn);

    address tokenIn  =  step.reverse ? pair.token1() : pair.token0();
    address tokenOut =  step.reverse ? pair.token0() : pair.token1();

    console.log(
      IERC20Metadata(tokenIn).symbol(),  IERC20(tokenIn).balanceOf(address(this)),
      IERC20Metadata(tokenOut).symbol(), IERC20(tokenOut).balanceOf(address(this)));

    amountIn = amountIn == MAX_AMOUNT ? IERC20(tokenIn).balanceOf(address(this)) : amountIn;
    IERC20(tokenIn).safeTransfer(address(pair), amountIn);

    bytes memory emptyData;
    (uint amountOut0, uint amountOut1) = _getAmountsOut(pair, amountIn, step.reverse);
    console.log('amountOut0, amountOut1', amountOut0, amountOut1);
    pair.swap(amountOut0, amountOut1, address(this), emptyData);
  }

  function _getAmountsOut(IUniswapV2Pair pair, uint amountIn, bool reverse)
  internal view returns(uint amountOut0, uint amountOut1) {
    (amountOut0, amountOut1) = (0, 0);
    uint fee = _getTetuSwapFee(address(pair));
    (uint112 reserve0, uint112 reserve1,) = pair.getReserves();

    if (reverse) {
      amountOut0 = _getAmountOut(amountIn, reserve1, reserve0, fee);
    } else {
      amountOut1 = _getAmountOut(amountIn, reserve0, reserve1, fee);
    }
  }

  /// @dev given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
  function _getAmountOut(uint amountIn, uint reserveIn, uint reserveOut, uint fee) internal view returns (uint amountOut) {
    require(amountIn > 0, "MS: INSUFFICIENT_INPUT_AMOUNT");
    require(reserveIn > 0 && reserveOut > 0, "MS: INSUFFICIENT_LIQUIDITY");
    uint amountInWithFee = amountIn * (_PRECISION_FEE - fee);
    uint numerator = amountInWithFee * reserveOut;
    uint denominator = reserveIn * _PRECISION_FEE + amountInWithFee;
    amountOut = numerator / denominator;
  }

  /// @dev returns fee for tetuswap or default uniswap v2 fee for other swaps
  function _getTetuSwapFee(address pair) internal view returns (uint) {
    try ITetuSwapPair(pair).fee() returns (uint fee) {
      return fee;
    } catch Error(string memory /*reason*/) {
    } catch (bytes memory /*lowLevelData*/) {
    }
    return 30;
  }

  // ************************* GOV ACTIONS *******************

  /// @notice Controller or Governance can claim coins that are somehow transferred into the contract
  /// @param _token Token address
  /// @param _amount Token amount
  function salvage(address _token, uint _amount) external {
    require(_isGovernance(msg.sender) || _isController(msg.sender), "MS: forbidden");
    IERC20(_token).safeTransfer(msg.sender, _amount);
  }

  // ************************* ASSET HELPERS *******************
  //

  // solhint-disable-next-line func-name-mixedcase
  function _WETH() internal view returns (address) {
    return _WETH_SLOT.getAddress();
  }

  /**
   * @dev Returns true if `asset` is the sentinel value that represents ETH.
   */
  function _isETH(IAsset asset) internal pure returns (bool) {
    return address(asset) == _ETH;
  }

  /**
   * @dev Translates `asset` into an equivalent IERC20 token address. If `asset` represents ETH, it will be translated
   * to the WETH contract.
   */
  function _translateToIERC20(IAsset asset) internal view returns (IERC20) {
    return _isETH(asset) ? IERC20(_WETH()) : _asIERC20(asset);
  }

  /**
   * @dev Same as `_translateToIERC20(IAsset)`, but for an entire array.
   */
  function _translateToIERC20(IAsset[] memory assets) internal view returns (IERC20[] memory) {
    IERC20[] memory tokens = new IERC20[](assets.length);
    for (uint256 i = 0; i < assets.length; ++i) {
      tokens[i] = _translateToIERC20(assets[i]);
    }
    return tokens;
  }

  /**
   * @dev Interprets `asset` as an IERC20 token. This function should only be called on `asset` if `_isETH` previously
   * returned false for it, that is, if `asset` is guaranteed not to be the ETH sentinel value.
   */
  function _asIERC20(IAsset asset) internal pure returns (IERC20) {
    return IERC20(address(asset));
  }

}