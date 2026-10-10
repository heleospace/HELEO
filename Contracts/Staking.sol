// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILEOEmission {
    function mintEmission(address to, uint256 amount) external;
    function remainingEmission() external view returns (uint256);
}

/// @notice Permissionless HELEO staking plus the four ecosystem buckets.
/// Staking is open from deployment; emission starts automatically emissionDelay
/// after deployment, so early stakers all start on equal footing. On Ethereum
/// mainnet the delay is enforced to be exactly MAINNET_EMISSION_DELAY (24 hours)
/// and the halving period exactly MAINNET_HALVING_PERIOD (4 years); testnets may
/// use shorter values (e.g. a 5-minute delay) for testing.
/// Every second of emission is split equally five ways:
///   1. Stakers  — distributed pro rata through a global accretion index
///   2. Builder  — community building wallet
///   3. Coder    — developer wallet
///   4. Compute  — GPU provider wallet
///   5. Research — research wallet
/// The stakers' share for any period with nobody staked is never minted. The four
/// bucket shares accrue on schedule regardless and are claimed by each bucket's
/// recipient wallet.
/// @dev The emission schedule is measured in seconds (block.timestamp), not block
/// numbers, so each halving lands a fixed wall-clock period apart regardless of
/// changes to Ethereum's block time or missed slots. On Ethereum mainnet a block's
/// timestamp is fixed by its slot, so proposers cannot shift it.
contract Staking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Bucket {
        Builder,
        Coder,
        Compute,
        Research
    }

    uint256 public constant PRECISION = 1e36;
    uint256 public constant GENESIS_ALLOCATION = 21_000_000 ether;
    // Halving series (FIRST_EPOCH_EMISSION * 2) asymptotically sums to
    // TOTAL_EMISSION and never quite reaches it under integer halving;
    // scheduledEmission() also clamps at TOTAL_EMISSION, so the cap always holds.
    uint256 public constant FIRST_EPOCH_EMISSION = 10_500_000 ether;
    uint256 public constant TOTAL_EMISSION = 21_000_000 ether;
    uint256 public constant MAX_EPOCHS = 256;
    /// @notice Stakers + Builder + Coder + Compute + Research.
    uint256 public constant BUCKET_COUNT = 5;
    uint256 public constant ECOSYSTEM_BUCKETS = 4;
    /// @notice The only emission delay accepted on Ethereum mainnet.
    uint256 public constant MAINNET_EMISSION_DELAY = 24 hours;
    /// @notice The only halving period accepted on Ethereum mainnet: 4 years of 365.25 days.
    uint256 public constant MAINNET_HALVING_PERIOD = 126_230_400;
    uint256 public constant MAINNET_CHAIN_ID = 1;
    // Every position is either 0 or >= MIN_STAKE, so totalStaked is either 0 or
    // >= MIN_STAKE whenever _update() divides by it. That bounds accRewardPerShare
    // for the contract's whole life at (TOTAL_EMISSION / 5) * PRECISION / MIN_STAKE
    // (~4.2e42), and any position (<= 4.2e25) times that index stays far below
    // 2^256. Without it, a 1-wei sole staker could inflate the index until
    // normal-sized stakes overflow and revert forever.
    uint256 public constant MIN_STAKE = 1 ether;

    IERC20 public immutable token;
    ILEOEmission public immutable rewardToken;
    /// @notice Length of each halving epoch, in seconds.
    uint256 public immutable halvingPeriod;
    /// @notice Delay between deployment and the start of emission.
    uint256 public immutable emissionDelay;
    /// @notice Emission start: deployment time + emissionDelay.
    uint256 public immutable startTime;

    uint256 public totalStaked;
    uint256 public accRewardPerShare;
    uint256 public lastUpdateTime;
    /// @notice scheduledEmission() value already split up by _update().
    uint256 public lastScheduled;
    /// @notice Stakers' share credited to the reward index so far.
    uint256 public stakerEmitted;
    /// @notice Stakers' share skipped because nobody was staked. Never minted.
    uint256 public stakerForfeited;

    address[4] public bucketRecipient;
    address[4] public pendingBucketRecipient;
    uint256[4] public bucketClaimed;

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 rewards;
    }

    mapping(address => UserInfo) public users;

    event Staked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 reward);
    event Compounded(address indexed user, uint256 reward, uint256 newStake);
    event Unstaked(address indexed user, uint256 principal, uint256 reward);
    event EmergencyWithdrawn(address indexed user, uint256 principal, uint256 forfeitedRewards);
    event IndexUpdated(uint256 fromTime, uint256 toTime, uint256 emission, uint256 index);
    event StakerShareForfeited(uint256 fromTime, uint256 toTime, uint256 amount);
    event BucketClaimed(Bucket indexed bucket, address indexed recipient, uint256 amount);
    event BucketRecipientProposed(Bucket indexed bucket, address indexed current, address indexed proposed);
    event BucketRecipientChanged(Bucket indexed bucket, address indexed previous, address indexed current);

    error ZeroAmount();
    error InsufficientStake();
    error BelowMinimumStake();
    error NoReward();
    error InvalidHalvingPeriod();
    error InvalidAddress();
    error NotBucketRecipient();
    error NotPendingRecipient();
    error InvalidEmissionDelay();

    /// @param halvingPeriod_ Seconds per halving epoch. Must be exactly
    ///        MAINNET_HALVING_PERIOD (4 years = 126_230_400) on Ethereum mainnet.
    /// @param recipients_ Initial wallets for Builder, Coder, Compute, Research.
    /// @param emissionDelay_ Seconds from deployment until emission starts. Must be
    ///        exactly MAINNET_EMISSION_DELAY (24 hours) on Ethereum mainnet.
    constructor(address token_, uint256 halvingPeriod_, address[4] memory recipients_, uint256 emissionDelay_) {
        if (token_ == address(0)) revert InvalidAddress();
        if (halvingPeriod_ == 0) revert InvalidHalvingPeriod();
        if (block.chainid == MAINNET_CHAIN_ID) {
            if (emissionDelay_ != MAINNET_EMISSION_DELAY) revert InvalidEmissionDelay();
            if (halvingPeriod_ != MAINNET_HALVING_PERIOD) revert InvalidHalvingPeriod();
        }
        for (uint256 i = 0; i < ECOSYSTEM_BUCKETS; ++i) {
            if (recipients_[i] == address(0)) revert InvalidAddress();
        }
        token = IERC20(token_);
        rewardToken = ILEOEmission(token_);
        halvingPeriod = halvingPeriod_;
        emissionDelay = emissionDelay_;
        startTime = block.timestamp + emissionDelay_;
        lastUpdateTime = startTime;
        bucketRecipient = recipients_;
    }

    // ---------------------------------------------------------------------
    // Staking
    // ---------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        UserInfo storage u = users[msg.sender];
        if (u.amount + amount < MIN_STAKE) revert BelowMinimumStake();

        _update();
        _settle(u);
        token.safeTransferFrom(msg.sender, address(this), amount);
        u.amount += amount;
        totalStaked += amount;
        u.rewardDebt = u.amount * accRewardPerShare / PRECISION;
        emit Staked(msg.sender, amount);
    }

    function claim() external nonReentrant returns (uint256 reward) {
        _update();
        UserInfo storage u = users[msg.sender];
        _settle(u);
        reward = u.rewards;
        if (reward == 0) revert NoReward();
        u.rewards = 0;
        reward = _capToMintable(reward);
        if (reward > 0) rewardToken.mintEmission(msg.sender, reward);
        emit Claimed(msg.sender, reward);
    }

    function compound() external nonReentrant returns (uint256 reward) {
        _update();
        UserInfo storage u = users[msg.sender];
        _settle(u);
        reward = u.rewards;
        if (reward == 0) revert NoReward();
        u.rewards = 0;
        reward = _capToMintable(reward);
        u.amount += reward;
        totalStaked += reward;
        u.rewardDebt = u.amount * accRewardPerShare / PRECISION;
        if (reward > 0) rewardToken.mintEmission(address(this), reward);
        emit Compounded(msg.sender, reward, u.amount);
    }

    function unstake(uint256 amount) external nonReentrant returns (uint256 reward) {
        if (amount == 0) revert ZeroAmount();
        _update();
        UserInfo storage u = users[msg.sender];
        if (amount > u.amount) revert InsufficientStake();
        uint256 remainingStake = u.amount - amount;
        if (remainingStake != 0 && remainingStake < MIN_STAKE) revert BelowMinimumStake();
        _settle(u);

        reward = u.rewards * amount / u.amount;
        u.rewards -= reward;
        u.amount = remainingStake;
        totalStaked -= amount;
        u.rewardDebt = u.amount * accRewardPerShare / PRECISION;

        reward = _capToMintable(reward);
        if (reward > 0) rewardToken.mintEmission(address(this), reward);
        token.safeTransfer(msg.sender, amount + reward);
        emit Unstaked(msg.sender, amount, reward);
    }

    /// @notice Principal-only exit. Never touches emission or reward minting, so
    /// it cannot be blocked by anything on the reward path. Forfeits all
    /// unclaimed rewards; the forfeited share of the not-yet-indexed window is
    /// distributed to the remaining stakers on the next update.
    function emergencyWithdraw() external nonReentrant {
        UserInfo storage u = users[msg.sender];
        uint256 amount = u.amount;
        if (amount == 0) revert InsufficientStake();
        uint256 forfeited = u.rewards;

        u.amount = 0;
        u.rewards = 0;
        u.rewardDebt = 0;
        totalStaked -= amount;

        token.safeTransfer(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, amount, forfeited);
    }

    // ---------------------------------------------------------------------
    // Ecosystem buckets
    // ---------------------------------------------------------------------

    /// @notice Mints everything the bucket has accrued so far to its recipient.
    /// Only the bucket's current recipient can call this.
    function claimBucket(Bucket bucket) external nonReentrant returns (uint256 amount) {
        uint256 i = uint256(bucket);
        address recipient = bucketRecipient[i];
        if (msg.sender != recipient) revert NotBucketRecipient();
        amount = bucketClaimable(bucket);
        if (amount == 0) revert NoReward();
        bucketClaimed[i] += amount;
        amount = _capToMintable(amount);
        if (amount > 0) rewardToken.mintEmission(recipient, amount);
        emit BucketClaimed(bucket, recipient, amount);
    }

    /// @notice Step 1 of handing a bucket to a new wallet. Only the current
    /// recipient can propose; pass address(0) to cancel a pending proposal.
    function proposeBucketRecipient(Bucket bucket, address newRecipient) external {
        uint256 i = uint256(bucket);
        if (msg.sender != bucketRecipient[i]) revert NotBucketRecipient();
        pendingBucketRecipient[i] = newRecipient;
        emit BucketRecipientProposed(bucket, msg.sender, newRecipient);
    }

    /// @notice Step 2: the proposed wallet accepts, proving it can sign. Anything
    /// the bucket has accrued but not yet claimed moves with it.
    function acceptBucketRecipient(Bucket bucket) external {
        uint256 i = uint256(bucket);
        if (msg.sender != pendingBucketRecipient[i] || msg.sender == address(0)) revert NotPendingRecipient();
        address previous = bucketRecipient[i];
        bucketRecipient[i] = msg.sender;
        pendingBucketRecipient[i] = address(0);
        emit BucketRecipientChanged(bucket, previous, msg.sender);
    }

    function bucketClaimable(Bucket bucket) public view returns (uint256) {
        return scheduledEmission(block.timestamp) / BUCKET_COUNT - bucketClaimed[uint256(bucket)];
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function pendingReward(address account) external view returns (uint256) {
        UserInfo memory u = users[account];
        uint256 index = previewIndex();
        uint256 accumulated = u.amount * index / PRECISION;
        uint256 pending = accumulated > u.rewardDebt ? accumulated - u.rewardDebt : 0;
        return u.rewards + pending;
    }

    function previewIndex() public view returns (uint256) {
        if (totalStaked == 0 || block.timestamp <= lastUpdateTime) return accRewardPerShare;
        uint256 share = (scheduledEmission(block.timestamp) - lastScheduled) / BUCKET_COUNT;
        if (share == 0) return accRewardPerShare;
        return accRewardPerShare + share * PRECISION / totalStaked;
    }

    /// @notice Read-only supply projection: genesis allocation + everything the
    /// halving schedule has made claimable so far (all four bucket shares, plus
    /// the stakers' share for every period someone was staked), free to read. The
    /// real ERC20 totalSupply() on LEO always remains the actual minted supply —
    /// this is only ever a schedule-based projection.
    function emittedSupply() external view returns (uint256) {
        uint256 scheduled = scheduledEmission(block.timestamp);
        uint256 stakers = stakerEmitted;
        if (totalStaked != 0 && scheduled > lastScheduled) {
            stakers += (scheduled - lastScheduled) / BUCKET_COUNT;
        }
        return GENESIS_ALLOCATION + (scheduled / BUCKET_COUNT) * ECOSYSTEM_BUCKETS + stakers;
    }

    function emissionStarted() public view returns (bool) {
        return block.timestamp >= startTime;
    }

    function currentEpoch() public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        return (block.timestamp - startTime) / halvingPeriod;
    }

    /// @notice Total emission per second across all five buckets. Each bucket
    /// (including stakers as a group) receives one fifth of this.
    function currentEmissionPerSecond() public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        uint256 epoch = currentEpoch();
        if (epoch >= MAX_EPOCHS) return 0;
        return (FIRST_EPOCH_EMISSION >> epoch) / halvingPeriod;
    }

    function nextHalvingTime() public view returns (uint256) {
        return startTime + (currentEpoch() + 1) * halvingPeriod;
    }

    /// @notice Cumulative emission (all five buckets) the schedule has released
    /// from startTime up to `time`. A pure function of time.
    function scheduledEmission(uint256 time) public view returns (uint256 total) {
        if (time <= startTime) return 0;
        uint256 elapsed = time - startTime;
        uint256 fullEpochs = elapsed / halvingPeriod;

        // Bounded by the number of halvings, never by elapsed time or number of users.
        for (uint256 e = 0; e < fullEpochs && e < MAX_EPOCHS; ++e) {
            uint256 epochEmission = FIRST_EPOCH_EMISSION >> e;
            if (epochEmission == 0) break;
            total += epochEmission;
        }
        if (fullEpochs < MAX_EPOCHS) {
            total += (FIRST_EPOCH_EMISSION >> fullEpochs) * (elapsed % halvingPeriod) / halvingPeriod;
        }

        return total > TOTAL_EMISSION ? TOTAL_EMISSION : total;
    }

    /// @notice Total emission (all five buckets) released between two times.
    function emissionBetween(uint256 fromTime, uint256 toTime) public view returns (uint256) {
        if (toTime <= fromTime) return 0;
        return scheduledEmission(toTime) - scheduledEmission(fromTime);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _update() internal {
        if (block.timestamp <= lastUpdateTime) return;

        uint256 scheduled = scheduledEmission(block.timestamp);
        uint256 share = (scheduled - lastScheduled) / BUCKET_COUNT;
        if (share > 0) {
            if (totalStaked == 0) {
                // Idle periods are permanently missed. They are not assigned to later stakers.
                stakerForfeited += share;
                emit StakerShareForfeited(lastUpdateTime, block.timestamp, share);
            } else {
                stakerEmitted += share;
                accRewardPerShare += share * PRECISION / totalStaked;
                emit IndexUpdated(lastUpdateTime, block.timestamp, share, accRewardPerShare);
            }
            // Advance by exactly what was split so the sub-5-wei remainder carries over.
            lastScheduled += share * BUCKET_COUNT;
        }
        lastUpdateTime = block.timestamp;
    }

    /// @dev Floor rounding in per-user accounting can leave total owed rewards a
    /// few wei above what LEO can still mint once emission is exhausted.
    /// Paying the excess would revert in mintEmission and, inside unstake(),
    /// trap principal. The unmintable dust is forfeited instead.
    function _capToMintable(uint256 reward) internal view returns (uint256) {
        uint256 mintable = rewardToken.remainingEmission();
        return reward > mintable ? mintable : reward;
    }

    function _settle(UserInfo storage u) internal {
        uint256 accumulated = u.amount * accRewardPerShare / PRECISION;
        if (accumulated > u.rewardDebt) {
            u.rewards += accumulated - u.rewardDebt;
        }
        u.rewardDebt = accumulated;
    }
}
