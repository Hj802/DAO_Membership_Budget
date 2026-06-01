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

    struct Proposal {
        ProposalType proposalType;
        address proposer;
        uint256 amountWei;
        address recipient;
        uint256 deadline;
        ApprovalType approvalType;
        ProposalStatus proposalStatus;
        bytes32 contentHash;
        bytes32 cancelReasonHash;
        uint256 canceledAt;
        uint256 yesVotes;
        uint256 noVotes;
    }

    uint256 private _nextProposalId = 1;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;
    mapping(uint256 => mapping(address => bool)) private _voteSupport;

    event DepositReceived(
        address indexed daoAddress,
        address indexed depositor,
        uint256 amount,
        uint256 balanceAfter,
        uint256 timestamp
    );
    event ProposalCreated(
        address indexed daoAddress,
        uint256 indexed proposalId,
        uint8 proposalType,
        address indexed proposer,
        uint256 amountWei,
        address recipient,
        uint256 deadline,
        uint8 approvalType,
        bytes32 contentHash
    );
    event ProposalCanceled(
        address indexed daoAddress,
        uint256 indexed proposalId,
        address indexed canceledBy,
        bytes32 cancelReasonHash,
        uint256 timestamp
    );
    event VoteCast(
        address indexed daoAddress,
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 timestamp
    );
    event ProposalFinalized(
        address indexed daoAddress,
        uint256 indexed proposalId,
        uint8 finalStatus,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 timestamp
    );

    error EmptyName();
    error InvalidCreator();
    error InvalidMember();
    error DuplicateMember(address member);
    error TooManyMembers();
    error InvalidApprovalRule();
    error NotMember(address account);
    error DaoNotActive(DaoStatus currentStatus);
    error ZeroDeposit();
    error InvalidProposalType();
    error InvalidApprovalType();
    error InvalidContentHash();
    error InvalidDeadline();
    error InvalidSpendingAmount();
    error InvalidRecipient();
    error InvalidTerminationFields();
    error ActiveProposalExists(uint256 proposalId);
    error ProposalNotFound(uint256 proposalId);
    error NotProposer(address account);
    error ProposalNotVoting(ProposalStatus currentStatus);
    error ProposalDeadlinePassed();
    error InvalidCancelReasonHash();
    error AlreadyVoted(address voter);
    error ProposalDeadlineNotReached();

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

    function currentBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function proposalCount() external view returns (uint256) {
        return _nextProposalId - 1;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);

        return _proposals[proposalId];
    }

    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);

        return _hasVoted[proposalId][voter];
    }

    function getVote(uint256 proposalId, address voter) external view returns (bool hasCast, bool support) {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);

        return (_hasVoted[proposalId][voter], _voteSupport[proposalId][voter]);
    }

    function deposit() external payable {
        if (!isMember[msg.sender]) revert NotMember(msg.sender);
        if (status != DaoStatus.Active) revert DaoNotActive(status);
        if (msg.value == 0) revert ZeroDeposit();

        emit DepositReceived(
            address(this),
            msg.sender,
            msg.value,
            address(this).balance,
            block.timestamp
        );
    }

    function createProposal(
        uint8 proposalType,
        uint256 amountWei,
        address recipient,
        uint256 deadline,
        uint8 approvalType,
        bytes32 contentHash
    ) external returns (uint256 proposalId) {
        if (!isMember[msg.sender]) revert NotMember(msg.sender);
        if (status != DaoStatus.Active) revert DaoNotActive(status);
        if (proposalType > uint8(ProposalType.Termination)) revert InvalidProposalType();
        if (approvalType > uint8(ApprovalType.Unanimous)) revert InvalidApprovalType();
        if (contentHash == bytes32(0)) revert InvalidContentHash();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        ProposalType typedProposalType = ProposalType(proposalType);

        if (typedProposalType == ProposalType.Spending) {
            if (amountWei == 0) revert InvalidSpendingAmount();
            if (recipient == address(0)) revert InvalidRecipient();
        } else {
            if (amountWei != 0 || recipient != address(0)) revert InvalidTerminationFields();
            _revertIfActiveProposalExists();
            status = DaoStatus.TerminationVoting;
        }

        proposalId = _nextProposalId;
        _nextProposalId += 1;

        _proposals[proposalId] = Proposal({
            proposalType: typedProposalType,
            proposer: msg.sender,
            amountWei: amountWei,
            recipient: recipient,
            deadline: deadline,
            approvalType: ApprovalType(approvalType),
            proposalStatus: ProposalStatus.Voting,
            contentHash: contentHash,
            cancelReasonHash: bytes32(0),
            canceledAt: 0,
            yesVotes: 0,
            noVotes: 0
        });

        emit ProposalCreated(
            address(this),
            proposalId,
            proposalType,
            msg.sender,
            amountWei,
            recipient,
            deadline,
            approvalType,
            contentHash
        );
    }

    function cancelProposal(uint256 proposalId, bytes32 cancelReasonHash) external {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);
        if (cancelReasonHash == bytes32(0)) revert InvalidCancelReasonHash();

        Proposal storage proposal = _proposals[proposalId];

        if (proposal.proposer != msg.sender) revert NotProposer(msg.sender);
        if (proposal.proposalStatus != ProposalStatus.Voting) {
            revert ProposalNotVoting(proposal.proposalStatus);
        }
        if (block.timestamp >= proposal.deadline) revert ProposalDeadlinePassed();

        proposal.proposalStatus = ProposalStatus.Canceled;
        proposal.cancelReasonHash = cancelReasonHash;
        proposal.canceledAt = block.timestamp;

        if (proposal.proposalType == ProposalType.Termination) {
            status = DaoStatus.Active;
        }

        emit ProposalCanceled(
            address(this),
            proposalId,
            msg.sender,
            cancelReasonHash,
            block.timestamp
        );
    }

    function vote(uint256 proposalId, bool support) external {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);
        if (!isMember[msg.sender]) revert NotMember(msg.sender);

        Proposal storage proposal = _proposals[proposalId];

        if (proposal.proposalStatus != ProposalStatus.Voting) {
            revert ProposalNotVoting(proposal.proposalStatus);
        }
        if (block.timestamp >= proposal.deadline) revert ProposalDeadlinePassed();
        if (_hasVoted[proposalId][msg.sender]) revert AlreadyVoted(msg.sender);

        _hasVoted[proposalId][msg.sender] = true;
        _voteSupport[proposalId][msg.sender] = support;

        if (support) {
            proposal.yesVotes += 1;
        } else {
            proposal.noVotes += 1;
        }

        emit VoteCast(address(this), proposalId, msg.sender, support, block.timestamp);
    }

    function finalizeProposal(uint256 proposalId) external {
        if (!_proposalExists(proposalId)) revert ProposalNotFound(proposalId);

        Proposal storage proposal = _proposals[proposalId];

        if (proposal.proposalStatus != ProposalStatus.Voting) {
            revert ProposalNotVoting(proposal.proposalStatus);
        }
        if (block.timestamp < proposal.deadline) revert ProposalDeadlineNotReached();

        ProposalStatus finalStatus = _isProposalApproved(proposal)
            ? ProposalStatus.Executable
            : ProposalStatus.Rejected;

        proposal.proposalStatus = finalStatus;

        if (proposal.proposalType == ProposalType.Termination && finalStatus == ProposalStatus.Rejected) {
            status = DaoStatus.Active;
        }

        emit ProposalFinalized(
            address(this),
            proposalId,
            uint8(finalStatus),
            proposal.yesVotes,
            proposal.noVotes,
            block.timestamp
        );
    }

    function _addMember(address member) private {
        if (member == address(0)) revert InvalidMember();
        if (isMember[member]) revert DuplicateMember(member);

        isMember[member] = true;
        _members.push(member);
    }

    function _proposalExists(uint256 proposalId) private view returns (bool) {
        return proposalId > 0 && proposalId < _nextProposalId;
    }

    function _revertIfActiveProposalExists() private view {
        for (uint256 proposalId = 1; proposalId < _nextProposalId; proposalId++) {
            ProposalStatus proposalStatus = _proposals[proposalId].proposalStatus;

            if (
                proposalStatus == ProposalStatus.Voting ||
                proposalStatus == ProposalStatus.Executable
            ) {
                revert ActiveProposalExists(proposalId);
            }
        }
    }

    function _isProposalApproved(Proposal storage proposal) private view returns (bool) {
        uint256 totalMemberCount = _members.length;

        if (proposal.approvalType == ApprovalType.Unanimous) {
            return proposal.yesVotes == totalMemberCount;
        }

        if (approvalRule == ApprovalRule.Majority) {
            return proposal.yesVotes * 2 > totalMemberCount;
        }

        return proposal.yesVotes * 3 >= totalMemberCount * 2;
    }
}
