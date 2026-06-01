// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DAOVault} from "./DAOVault.sol";

contract DAOFactory {
    address[] private _allDAOs;
    mapping(address => address[]) private _daosByMember;

    event DAOCreated(
        address indexed daoAddress,
        address indexed creator,
        string name,
        uint256 memberCount,
        uint8 approvalRule,
        uint256 createdAt
    );

    function createDAO(
        string memory name,
        address[] memory additionalMembers,
        uint8 approvalRule
    ) external returns (address daoAddress) {
        DAOVault dao = new DAOVault(name, msg.sender, additionalMembers, approvalRule);
        daoAddress = address(dao);

        _allDAOs.push(daoAddress);

        address[] memory members = dao.getMembers();
        for (uint256 i = 0; i < members.length; i++) {
            _daosByMember[members[i]].push(daoAddress);
        }

        emit DAOCreated(daoAddress, msg.sender, name, members.length, approvalRule, block.timestamp);
    }

    function getDAOsByMember(address member) external view returns (address[] memory) {
        return _daosByMember[member];
    }

    function getAllDAOs() external view returns (address[] memory) {
        return _allDAOs;
    }
}
