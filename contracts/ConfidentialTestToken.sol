// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ConfidentialTestToken is ERC7984, ZamaEthereumConfig, Ownable {
    constructor(address initialOwner, uint64 initialSupply)
        ERC7984("Confidential Test Token", "cTEST", "")
        Ownable(initialOwner)
    {
        _mint(initialOwner, FHE.asEuint64(initialSupply));
    }

    function mint(address to, uint64 amount) external onlyOwner {
        _mint(to, FHE.asEuint64(amount));
    }
}
