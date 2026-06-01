// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DAOVault} from "../DAOVault.sol";

contract DAOVaultHarness is DAOVault {
    constructor(
        string memory daoName,
        address daoCreator,
        address[] memory additionalMembers,
        uint8 defaultApprovalRule
    ) DAOVault(daoName, daoCreator, additionalMembers, defaultApprovalRule) {}

    function setStatusForTest(DaoStatus nextStatus) external {
        status = nextStatus;
    }
}
