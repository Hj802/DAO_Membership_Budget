// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract DAOVault {
    uint256 public constant MAX_MEMBER_COUNT = 20;

    enum ApprovalRule {
        Majority,
        TwoThirds
    }

    enum ApprovalType {
        Default,
        Unanimous
    }

    enum ProposalType {
        Spending,
        Termination
    }

    enum ProposalStatus {
        Voting,
        Canceled,
        Rejected,
        Executable,
        Executed,
        ExecutionFailed
    }

    enum DaoStatus {
        Active,
        TerminationVoting,
        Terminated
    }

    string public name;
    address public immutable creator;
    ApprovalRule public immutable approvalRule;
    DaoStatus public status;

    address[] private _members;
    mapping(address => bool) public isMember;

    error EmptyName();
    error InvalidCreator();
    error InvalidMember();
    error DuplicateMember(address member);
    error TooManyMembers();
    error InvalidApprovalRule();

    constructor(
        string memory daoName,
        address daoCreator,
        address[] memory additionalMembers,
        uint8 defaultApprovalRule
    ) {
        if (bytes(daoName).length == 0) revert EmptyName();
        if (daoCreator == address(0)) revert InvalidCreator();
        if (defaultApprovalRule > uint8(ApprovalRule.TwoThirds)) revert InvalidApprovalRule();
        if (additionalMembers.length + 1 > MAX_MEMBER_COUNT) revert TooManyMembers();

        name = daoName;
        creator = daoCreator;
        approvalRule = ApprovalRule(defaultApprovalRule);
        status = DaoStatus.Active;

        _addMember(daoCreator);

        for (uint256 i = 0; i < additionalMembers.length; i++) {
            _addMember(additionalMembers[i]);
        }
    }

    function getMembers() external view returns (address[] memory) {
        return _members;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function _addMember(address member) private {
        if (member == address(0)) revert InvalidMember();
        if (isMember[member]) revert DuplicateMember(member);

        isMember[member] = true;
        _members.push(member);
    }
}
