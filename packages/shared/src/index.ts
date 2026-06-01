export const SEPOLIA_CHAIN_ID = 11155111;
export const MAX_DAO_MEMBER_COUNT = 20;

export enum ApprovalRule {
  Majority = 0,
  TwoThirds = 1,
}

export enum ApprovalType {
  Default = 0,
  Unanimous = 1,
}

export enum ProposalType {
  Spending = 0,
  Termination = 1,
}

export enum ProposalStatus {
  Voting = 0,
  Canceled = 1,
  Rejected = 2,
  Executable = 3,
  Executed = 4,
  ExecutionFailed = 5,
}

export enum DaoStatus {
  Active = 0,
  TerminationVoting = 1,
  Terminated = 2,
}
