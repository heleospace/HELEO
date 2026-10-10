import type { PublicClient, Address } from 'viem';
import { LEO_ABI, STAKING_ABI, BUCKETS } from '../config/contracts';
import type { ContractAddresses } from '../config/networks';
import type { ContractStats, UserStakingInfo, UserData, BucketInfo } from '../types/index';

export async function getContractStats(publicClient: PublicClient | null, contracts: ContractAddresses): Promise<ContractStats | null> {
  if (!publicClient || !contracts.LEO || !contracts.STAKING) {
    return null;
  }

  const leo = { address: contracts.LEO as Address, abi: LEO_ABI } as const;
  const staking = { address: contracts.STAKING as Address, abi: STAKING_ABI } as const;

  try {
    const [totalSupply, emittedSupply, emissionMinted, remainingEmission, totalStaked, stakerForfeited, currentEpoch, emissionPerSecond, nextHalvingTime, startTime, halvingPeriod] = await Promise.all([
      publicClient.readContract({ ...leo, functionName: 'totalSupply' }) as Promise<bigint>,
      publicClient.readContract({ ...leo, functionName: 'emittedSupply' }) as Promise<bigint>,
      publicClient.readContract({ ...leo, functionName: 'emissionMinted' }) as Promise<bigint>,
      publicClient.readContract({ ...leo, functionName: 'remainingEmission' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'totalStaked' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'stakerForfeited' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'currentEpoch' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'currentEmissionPerSecond' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'nextHalvingTime' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'startTime' }) as Promise<bigint>,
      publicClient.readContract({ ...staking, functionName: 'halvingPeriod' }) as Promise<bigint>,
    ]);

    return {
      totalSupply,
      emittedSupply,
      totalStaked,
      emissionMinted,
      remainingEmission,
      stakerForfeited,
      currentEpoch,
      emissionPerSecond,
      nextHalvingTime,
      startTime,
      halvingPeriod,
    };
  } catch (error) {
    console.error('Error fetching contract stats:', error);
    return null;
  }
}

export async function getUserData(publicClient: PublicClient | null, userAddress: Address, contracts: ContractAddresses): Promise<UserData | null> {
  if (!publicClient || !userAddress || !contracts.STAKING) {
    return null;
  }

  const staking = { address: contracts.STAKING as Address, abi: STAKING_ABI } as const;

  try {
    const [stakingInfoResult, pendingReward] = await Promise.all([
      publicClient.readContract({ ...staking, functionName: 'users', args: [userAddress] }) as unknown as Promise<[bigint, bigint, bigint]>,
      publicClient.readContract({ ...staking, functionName: 'pendingReward', args: [userAddress] }) as unknown as Promise<bigint>,
    ]);

    const stakingInfo: UserStakingInfo | null = stakingInfoResult ? {
      amount: stakingInfoResult[0],
      rewardDebt: stakingInfoResult[1],
      rewards: stakingInfoResult[2],
    } : null;

    return { stakingInfo, pendingReward };
  } catch (error) {
    console.error('Error fetching user data:', error);
    return null;
  }
}

export async function getBuckets(publicClient: PublicClient | null, contracts: ContractAddresses): Promise<BucketInfo[] | null> {
  if (!publicClient || !contracts.STAKING) {
    return null;
  }

  const staking = { address: contracts.STAKING as Address, abi: STAKING_ABI } as const;

  try {
    return await Promise.all(
      BUCKETS.map(async ({ id }) => {
        const index = BigInt(id);
        const [recipient, pendingRecipient, claimed, claimable] = await Promise.all([
          publicClient.readContract({ ...staking, functionName: 'bucketRecipient', args: [index] }) as Promise<string>,
          publicClient.readContract({ ...staking, functionName: 'pendingBucketRecipient', args: [index] }) as Promise<string>,
          publicClient.readContract({ ...staking, functionName: 'bucketClaimed', args: [index] }) as Promise<bigint>,
          publicClient.readContract({ ...staking, functionName: 'bucketClaimable', args: [id] }) as Promise<bigint>,
        ]);
        return { id, recipient, pendingRecipient, claimed, claimable };
      })
    );
  } catch (error) {
    console.error('Error fetching buckets:', error);
    return null;
  }
}
