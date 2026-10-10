// Sepolia-specific contract addresses. The LayerZero bridge (config/bridge.ts,
// pages/Bridge.tsx, pages/deploy/DeployBridge.tsx) always uses Sepolia as its
// home chain regardless of the Ethereum/Sepolia network switch in the header —
// this export exists for that fixed use. Everywhere else in the app should use
// useNetwork()'s current network.contracts instead (see context/NetworkContext).
export const CONTRACTS = {
  LEO: import.meta.env.VITE_LEO_ADDRESS_SEPOLIA || '',
  STAKING: import.meta.env.VITE_STAKING_ADDRESS_SEPOLIA || '',
};

// Ecosystem buckets, in the order of Staking.Bucket (uint8 0..3). Stakers are the
// fifth bucket and are paid through the staking index instead.
export const BUCKETS = [
  { id: 0, key: 'builder', name: 'Builder', description: 'Community building' },
  { id: 1, key: 'coder', name: 'Coder', description: 'Developers' },
  { id: 2, key: 'compute', name: 'Compute', description: 'GPU providers' },
  { id: 3, key: 'research', name: 'Research', description: 'Research' },
] as const;

// Contract ABIs
export const LEO_ABI = [
  {
    "inputs": [],
    "name": "MAX_SUPPLY",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "GENESIS_ALLOCATION",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "EMISSION_ALLOCATION",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "emittedSupply",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "emissionMinted",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "remainingEmission",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "owner",
        "type": "address"
      },
      {
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "spender",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const STAKING_ABI = [
  {
    "inputs": [
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "stake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claim",
    "outputs": [
      {
        "name": "reward",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "compound",
    "outputs": [
      {
        "name": "reward",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "unstake",
    "outputs": [
      {
        "name": "reward",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "emergencyWithdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalStaked",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "name": "pendingReward",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "name": "users",
    "outputs": [
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "rewardDebt",
        "type": "uint256"
      },
      {
        "name": "rewards",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "startTime",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "halvingPeriod",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentEpoch",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentEmissionPerSecond",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextHalvingTime",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "emittedSupply",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "emissionStarted",
    "outputs": [
      {
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "stakerEmitted",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "stakerForfeited",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "bucketRecipient",
    "outputs": [
      {
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "pendingBucketRecipient",
    "outputs": [
      {
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "bucketClaimed",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "bucket",
        "type": "uint8"
      }
    ],
    "name": "bucketClaimable",
    "outputs": [
      {
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "bucket",
        "type": "uint8"
      }
    ],
    "name": "claimBucket",
    "outputs": [
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "bucket",
        "type": "uint8"
      },
      {
        "name": "newRecipient",
        "type": "address"
      }
    ],
    "name": "proposeBucketRecipient",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "bucket",
        "type": "uint8"
      }
    ],
    "name": "acceptBucketRecipient",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
