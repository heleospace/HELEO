export interface UserStakingInfo {
  amount: bigint;
  rewardDebt: bigint;
  rewards: bigint;
}

export interface ContractStats {
  totalSupply: bigint;
  emittedSupply: bigint;
  totalStaked: bigint;
  emissionMinted: bigint;
  remainingEmission: bigint;
  stakerForfeited: bigint;
  currentEpoch: bigint;
  emissionPerSecond: bigint;
  nextHalvingTime: bigint;
  startTime: bigint;
  halvingPeriod: bigint;
}

export interface BucketInfo {
  id: number;
  recipient: string;
  pendingRecipient: string;
  claimed: bigint;
  claimable: bigint;
}

export interface UserData {
  stakingInfo: UserStakingInfo | null;
  pendingReward: bigint;
}
