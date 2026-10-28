// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAgentAccountPay {
    function payETH(address payable to, uint256 amount) external;
}

/// @notice Test agent that tries to pay itself again from inside the ETH it receives.
contract ReentrantAgent {
    IAgentAccountPay public account;
    uint256 public reentries;

    function setAccount(IAgentAccountPay account_) external {
        account = account_;
    }

    function start(uint256 amount) external {
        account.payETH(payable(address(this)), amount);
    }

    receive() external payable {
        if (reentries == 0) {
            reentries++;
            account.payETH(payable(address(this)), msg.value);
        }
    }
}
