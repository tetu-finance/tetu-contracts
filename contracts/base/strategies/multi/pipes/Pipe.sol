// SPDX-License-Identifier: ISC
pragma solidity ^0.8.0;

/// @title Pipe Base Contract
/// @author bogdoslav
abstract contract Pipe {

    //  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    /// !!! WARNING! Ancestors must no have any storage variables !!!
    //  !!! It should receive all data trough abi-encoded context !!!
    //  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    string private constant _NOT_IMPLEMENTED = "PIPE: not implemented";

    /// See ./WrappingPipe.sol and ./AaveWethPipe.sol for creating/decoding context example
    /// dev create context from desired parameters
    //function create(...) public pure returns (bytes memory)

    /// dev decode context to variables
    //function context(bytes memory c) private pure returns (...)

    /// @dev function for investing, deposits, entering, borrowing
    /// @param c abi-encoded context
    /// @param amount in source units
    /// @return output in underlying units
    function put(bytes memory c, uint256 amount) virtual public returns (uint256 output);

    /// @dev function for de-vesting, withdrawals, leaves, paybacks. Amount in underlying units
    /// @param c abi-encoded context
    /// @param amount in underlying units
    /// @return output in source units
    function get(bytes memory c, uint256 amount) virtual public returns (uint256 output);

    /// @dev function for hardwork, claiming rewards, balancing
    /// @param c abi-encoded context
    function work(bytes memory c) virtual public {
        // do nothing by default
    }

    /// @dev available source balance (tokens, matic etc)
    /// param c abi-encoded context
    /// @return balance in source units
    function balance(bytes memory) virtual public returns (uint256) {
        revert(_NOT_IMPLEMENTED);
    }

    /// @dev underlying balance (LP tokens, collateral etc)
    /// param c abi-encoded context
    /// @return balance in underlying units
    function underlyingBalance(bytes memory) virtual public returns (uint256) {
        revert(_NOT_IMPLEMENTED);
    }

}
