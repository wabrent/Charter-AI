// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test stand-in for the ERC-8004 Identity Registry: agents are ERC-721 tokens.
contract MockIdentity is ERC721 {
    constructor() ERC721("Mock Agent Identity", "AGENT") {}

    function mint(address to, uint256 agentId) external {
        _mint(to, agentId);
    }
}
