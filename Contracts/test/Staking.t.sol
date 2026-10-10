// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../LEO.sol";
import {Staking} from "../Staking.sol";

uint256 constant DELAY = 24 hours;

contract StakingTest is Test {
    LEO leo;
    Staking staking;

    uint256 constant HALVING_PERIOD = 1000;
    uint256 constant FIVE = 5;

    address[9] contributors;
    address alice;
    address bob;
    address builder = address(0xB1);
    address coder = address(0xC0);
    address compute = address(0xC1);
    address research = address(0xE5);

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x1000 + i));
        alice = contributors[0];
        bob = contributors[1];
        leo = new LEO(contributors);
        staking = new Staking(address(leo), HALVING_PERIOD, _recipients(), DELAY);
        leo.setStaking(address(staking));
    }

    function _recipients() internal view returns (address[4] memory r) {
        r = [builder, coder, compute, research];
    }

    function _stake(address who, uint256 amount) internal {
        vm.startPrank(who);
        leo.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    function _startEmission() internal {
        vm.warp(staking.startTime());
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(Staking.InvalidAddress.selector);
        new Staking(address(0), HALVING_PERIOD, _recipients(), DELAY);
    }

    function test_constructor_revertsOnZeroRecipient() public {
        for (uint256 i = 0; i < 4; i++) {
            address[4] memory r = _recipients();
            r[i] = address(0);
            vm.expectRevert(Staking.InvalidAddress.selector);
            new Staking(address(leo), HALVING_PERIOD, r, DELAY);
        }
    }

    function test_constructor_revertsOnZeroHalvingPeriod() public {
        vm.expectRevert(Staking.InvalidHalvingPeriod.selector);
        new Staking(address(leo), 0, _recipients(), DELAY);
    }

    function test_constructor_setsRecipientsAndStartTime() public view {
        assertEq(staking.bucketRecipient(0), builder);
        assertEq(staking.bucketRecipient(1), coder);
        assertEq(staking.bucketRecipient(2), compute);
        assertEq(staking.bucketRecipient(3), research);
        assertEq(staking.startTime(), block.timestamp + 24 hours);
        assertEq(staking.emissionDelay(), 24 hours);
        assertEq(staking.lastUpdateTime(), staking.startTime());
    }

    function test_constructor_mainnetRequiresExactly24h() public {
        vm.chainId(1);
        vm.expectRevert(Staking.InvalidEmissionDelay.selector);
        new Staking(address(leo), HALVING_PERIOD, _recipients(), 5 minutes);
        vm.expectRevert(Staking.InvalidEmissionDelay.selector);
        new Staking(address(leo), HALVING_PERIOD, _recipients(), 48 hours);

        Staking mainnetStaking = new Staking(address(leo), HALVING_PERIOD, _recipients(), 24 hours);
        assertEq(mainnetStaking.startTime(), block.timestamp + 24 hours);
    }

    function test_constructor_testnetAllowsShortDelay() public {
        vm.chainId(11155111); // Sepolia
        Staking testStaking = new Staking(address(leo), HALVING_PERIOD, _recipients(), 5 minutes);
        assertEq(testStaking.emissionDelay(), 5 minutes);
        assertEq(testStaking.startTime(), block.timestamp + 5 minutes);

        vm.warp(block.timestamp + 5 minutes - 1);
        assertFalse(testStaking.emissionStarted());
        vm.warp(block.timestamp + 1);
        assertTrue(testStaking.emissionStarted());
    }

    // ---------------------------------------------------------------------
    // 24h start delay
    // ---------------------------------------------------------------------

    function test_stake_openImmediatelyAtDeploy() public {
        _stake(alice, 10 ether);
        assertEq(staking.totalStaked(), 10 ether);
        assertFalse(staking.emissionStarted());
    }

    function test_noEmissionBeforeStart() public {
        _stake(alice, 10 ether);
        vm.warp(staking.startTime() - 1);
        assertEq(staking.pendingReward(alice), 0);
        assertEq(staking.currentEmissionPerSecond(), 0);
        assertEq(staking.bucketClaimable(Staking.Bucket.Builder), 0);
        assertEq(staking.emittedSupply(), leo.GENESIS_ALLOCATION());

        vm.prank(alice);
        vm.expectRevert(Staking.NoReward.selector);
        staking.claim();
    }

    function test_emissionStartsAutomaticallyAfter24h() public {
        _stake(alice, 10 ether);
        _startEmission();
        assertTrue(staking.emissionStarted());
        vm.warp(block.timestamp + 100);
        assertGt(staking.pendingReward(alice), 0);
    }

    /// @dev Everyone who staked during the 24h window starts accruing at exactly
    /// the same moment, regardless of how early they staked.
    function test_earlyStakers_startOnEqualFooting() public {
        _stake(alice, 10 ether); // at deploy
        vm.warp(staking.startTime() - 1);
        _stake(bob, 10 ether); // one second before start
        vm.warp(staking.startTime() + 100);
        assertApproxEqAbs(staking.pendingReward(alice), staking.pendingReward(bob), 1);
    }

    function test_unstakeBeforeStart_returnsPrincipalWithNoReward() public {
        uint256 bal = leo.balanceOf(alice);
        _stake(alice, 10 ether);
        vm.prank(alice);
        uint256 reward = staking.unstake(10 ether);
        assertEq(reward, 0);
        assertEq(leo.balanceOf(alice), bal);
    }

    // ---------------------------------------------------------------------
    // Five-way split
    // ---------------------------------------------------------------------

    function test_soleStaker_receivesOneFifthOfEmission() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 expected = staking.FIRST_EPOCH_EMISSION() * 100 / HALVING_PERIOD / FIVE;
        assertApproxEqAbs(staking.pendingReward(alice), expected, 1e6);
    }

    function test_eachBucket_receivesOneFifthOfEmission() public {
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 expected = staking.scheduledEmission(block.timestamp) / FIVE;
        assertEq(staking.bucketClaimable(Staking.Bucket.Builder), expected);
        assertEq(staking.bucketClaimable(Staking.Bucket.Coder), expected);
        assertEq(staking.bucketClaimable(Staking.Bucket.Compute), expected);
        assertEq(staking.bucketClaimable(Staking.Bucket.Research), expected);
    }

    function test_stakersAndBuckets_getEqualShares() public {
        _stake(alice, 10 ether);
        _stake(bob, 30 ether);
        _startEmission();
        vm.warp(block.timestamp + 250);

        uint256 stakersTotal = staking.pendingReward(alice) + staking.pendingReward(bob);
        assertApproxEqAbs(stakersTotal, staking.bucketClaimable(Staking.Bucket.Research), 10);
    }

    /// @dev Chosen rule: the stakers' share for any period with nobody staked is
    /// never minted, but the four buckets still accrue their shares on schedule.
    function test_noStakers_stakerShareForfeited_bucketsStillAccrue() public {
        _startEmission();
        vm.warp(block.timestamp + 500);

        _stake(alice, 10 ether); // triggers _update over the idle window
        assertEq(staking.pendingReward(alice), 0);
        uint256 idleShare = staking.scheduledEmission(block.timestamp) / FIVE;
        assertApproxEqAbs(staking.stakerForfeited(), idleShare, 1);
        assertEq(staking.stakerEmitted(), 0);
        assertEq(staking.bucketClaimable(Staking.Bucket.Builder), idleShare);
    }

    function test_idlePeriodsAreNotRetroactivelyCredited() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        staking.unstake(10 ether);

        vm.warp(block.timestamp + 1000);
        // Nobody staked during this gap: emission should not have accrued for it.
        _stake(bob, 10 ether);
        assertEq(staking.pendingReward(bob), 0);
    }

    // ---------------------------------------------------------------------
    // Buckets: claim
    // ---------------------------------------------------------------------

    function test_claimBucket_mintsToRecipient() public {
        _startEmission();
        vm.warp(block.timestamp + 100);
        uint256 claimable = staking.bucketClaimable(Staking.Bucket.Coder);

        vm.prank(coder);
        uint256 amount = staking.claimBucket(Staking.Bucket.Coder);

        assertEq(amount, claimable);
        assertEq(leo.balanceOf(coder), claimable);
        assertEq(staking.bucketClaimable(Staking.Bucket.Coder), 0);
        assertEq(staking.bucketClaimed(1), claimable);
    }

    function test_claimBucket_onlyRecipient() public {
        _startEmission();
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(Staking.Bucket.Builder);

        // A recipient cannot claim a different bucket either.
        vm.prank(builder);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(Staking.Bucket.Compute);
    }

    function test_claimBucket_revertsWhenNothingAccrued() public {
        vm.prank(research);
        vm.expectRevert(Staking.NoReward.selector);
        staking.claimBucket(Staking.Bucket.Research);
    }

    function test_claimBucket_repeatedClaimsSumToShare() public {
        _startEmission();
        for (uint256 i = 0; i < 5; i++) {
            vm.warp(block.timestamp + 77);
            vm.prank(compute);
            staking.claimBucket(Staking.Bucket.Compute);
        }
        assertEq(leo.balanceOf(compute), staking.scheduledEmission(block.timestamp) / FIVE);
    }

    // ---------------------------------------------------------------------
    // Buckets: two-step hand-off
    // ---------------------------------------------------------------------

    function test_handoff_twoStep() public {
        address newBuilder = address(0xBEEF);
        vm.prank(builder);
        staking.proposeBucketRecipient(Staking.Bucket.Builder, newBuilder);
        assertEq(staking.pendingBucketRecipient(0), newBuilder);
        assertEq(staking.bucketRecipient(0), builder); // unchanged until accepted

        vm.prank(newBuilder);
        staking.acceptBucketRecipient(Staking.Bucket.Builder);
        assertEq(staking.bucketRecipient(0), newBuilder);
        assertEq(staking.pendingBucketRecipient(0), address(0));
    }

    function test_handoff_unclaimedAccrualMovesToNewRecipient() public {
        _startEmission();
        vm.warp(block.timestamp + 100);
        address newCoder = address(0xBEEF);

        vm.prank(coder);
        staking.proposeBucketRecipient(Staking.Bucket.Coder, newCoder);
        vm.prank(newCoder);
        staking.acceptBucketRecipient(Staking.Bucket.Coder);

        vm.prank(coder);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(Staking.Bucket.Coder);

        vm.prank(newCoder);
        uint256 amount = staking.claimBucket(Staking.Bucket.Coder);
        assertGt(amount, 0);
        assertEq(leo.balanceOf(newCoder), amount);
    }

    function test_handoff_onlyCurrentRecipientCanPropose() public {
        vm.prank(alice);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.proposeBucketRecipient(Staking.Bucket.Research, alice);
    }

    function test_handoff_onlyProposedWalletCanAccept() public {
        vm.prank(research);
        staking.proposeBucketRecipient(Staking.Bucket.Research, address(0xBEEF));
        vm.prank(alice);
        vm.expectRevert(Staking.NotPendingRecipient.selector);
        staking.acceptBucketRecipient(Staking.Bucket.Research);
    }

    function test_handoff_cancelWithZeroAddress() public {
        vm.startPrank(research);
        staking.proposeBucketRecipient(Staking.Bucket.Research, address(0xBEEF));
        staking.proposeBucketRecipient(Staking.Bucket.Research, address(0));
        vm.stopPrank();

        vm.prank(address(0xBEEF));
        vm.expectRevert(Staking.NotPendingRecipient.selector);
        staking.acceptBucketRecipient(Staking.Bucket.Research);
        assertEq(staking.bucketRecipient(3), research);
    }

    function test_handoff_acceptRevertsWithNoProposal() public {
        vm.prank(address(0));
        vm.expectRevert(Staking.NotPendingRecipient.selector);
        staking.acceptBucketRecipient(Staking.Bucket.Builder);
    }

    // ---------------------------------------------------------------------
    // Core staking (unchanged behaviour)
    // ---------------------------------------------------------------------

    function test_stake_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(Staking.ZeroAmount.selector);
        staking.stake(0);
    }

    function test_claim_mintsExactPendingReward() public {
        uint256 bal = leo.balanceOf(alice);
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 pending = staking.pendingReward(alice);
        assertGt(pending, 0);

        vm.prank(alice);
        uint256 reward = staking.claim();
        assertEq(reward, pending);
        assertEq(leo.balanceOf(alice), bal - 10 ether + pending);
    }

    function test_claim_revertsIfNoReward() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.prank(alice);
        vm.expectRevert(Staking.NoReward.selector);
        staking.claim();
    }

    function test_compound_increasesStakeByReward() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 pending = staking.pendingReward(alice);
        vm.prank(alice);
        uint256 reward = staking.compound();

        assertEq(reward, pending);
        (uint256 amount,,) = staking.users(alice);
        assertEq(amount, 10 ether + pending);
        assertEq(staking.totalStaked(), 10 ether + pending);
    }

    function test_unstake_returnsPrincipalAndProportionalReward() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 pending = staking.pendingReward(alice);
        uint256 balBefore = leo.balanceOf(alice);

        vm.prank(alice);
        uint256 reward = staking.unstake(10 ether);

        assertEq(reward, pending);
        assertEq(leo.balanceOf(alice), balBefore + 10 ether + reward);
        (uint256 amount,,) = staking.users(alice);
        assertEq(amount, 0);
        assertEq(staking.totalStaked(), 0);
    }

    function test_unstake_revertsOnZeroAmount() public {
        _stake(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(Staking.ZeroAmount.selector);
        staking.unstake(0);
    }

    function test_unstake_revertsIfExceedsStake() public {
        _stake(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(Staking.InsufficientStake.selector);
        staking.unstake(11 ether);
    }

    function test_twoStakers_splitEmissionProportionally() public {
        _stake(alice, 10 ether);
        _stake(bob, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);
        assertApproxEqAbs(staking.pendingReward(alice), staking.pendingReward(bob), 1e6);
    }

    function test_partialUnstake_thenMoreRewardAccrues_noUnderflowNoLoss() public {
        _stake(alice, 15 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        uint256 pendingBeforePartial = staking.pendingReward(alice);
        vm.prank(alice);
        uint256 rewardFromUnstake = staking.unstake(6 ether);
        assertEq(rewardFromUnstake, pendingBeforePartial * 6 / 15);

        (uint256 amountAfter,, uint256 leftoverRewards) = staking.users(alice);
        assertEq(amountAfter, 9 ether);
        assertEq(leftoverRewards, pendingBeforePartial - rewardFromUnstake);

        vm.warp(block.timestamp + 100);
        uint256 pendingAfter = staking.pendingReward(alice);
        vm.prank(alice);
        uint256 claimed = staking.claim();
        assertEq(claimed, pendingAfter);
        assertApproxEqAbs(claimed, leftoverRewards + staking.currentEmissionPerSecond() * 100 / FIVE, 2);
    }

    function test_partialUnstake_withOtherStakerPresent_noDriftInTotals() public {
        _stake(alice, 15 ether);
        _stake(bob, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);

        vm.prank(alice);
        staking.unstake(6 ether);
        vm.warp(block.timestamp + 100);

        vm.prank(alice);
        staking.claim();
        vm.prank(bob);
        staking.claim();

        // No buckets claimed yet, so everything minted is stakers' rewards.
        assertApproxEqAbs(leo.emissionMinted(), staking.stakerEmitted(), 10);
        (uint256 aliceAmount,,) = staking.users(alice);
        (uint256 bobAmount,,) = staking.users(bob);
        assertEq(aliceAmount + bobAmount, staking.totalStaked());
    }

    // ---------------------------------------------------------------------
    // Minimum position size (dust-stake index inflation)
    // ---------------------------------------------------------------------

    function test_stake_revertsBelowMinimum() public {
        uint256 justUnder = staking.MIN_STAKE() - 1;
        vm.startPrank(alice);
        leo.approve(address(staking), type(uint256).max);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.stake(1);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.stake(justUnder);
        vm.stopPrank();
    }

    function test_stake_smallTopUpAllowedOnceAboveMinimum() public {
        _stake(alice, 1 ether);
        _stake(alice, 1);
        (uint256 amount,,) = staking.users(alice);
        assertEq(amount, 1 ether + 1);
    }

    function test_unstake_revertsIfItWouldLeaveDust() public {
        _stake(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.unstake(1.5 ether);

        vm.prank(alice);
        staking.unstake(1 ether);
        vm.prank(alice);
        staking.unstake(1 ether);
        (uint256 amount,,) = staking.users(alice);
        assertEq(amount, 0);
    }

    /// @dev Worst case: a sole staker at exactly MIN_STAKE for the whole schedule
    /// maximizes accRewardPerShare. The largest realistic position must still be
    /// stakeable, readable and withdrawable without overflow.
    function test_dustAttack_worstCaseIndexCannotBrickLargePositions() public {
        _stake(alice, staking.MIN_STAKE());
        _startEmission();
        vm.warp(block.timestamp + HALVING_PERIOD * 300);
        vm.prank(alice);
        staking.claim();

        assertLe(
            staking.accRewardPerShare(),
            (staking.TOTAL_EMISSION() / FIVE) * staking.PRECISION() / staking.MIN_STAKE()
        );

        // Gather the largest position that can realistically exist.
        for (uint256 i = 1; i < 9; i++) {
            vm.startPrank(contributors[i]);
            leo.transfer(alice, leo.balanceOf(contributors[i]));
            vm.stopPrank();
        }
        uint256 everything = leo.balanceOf(alice);
        assertGt(everything, 25_000_000 ether);
        _stake(alice, everything);

        staking.pendingReward(alice);
        (uint256 aliceAmount,,) = staking.users(alice);
        vm.prank(alice);
        staking.unstake(aliceAmount);
        (aliceAmount,,) = staking.users(alice);
        assertEq(aliceAmount, 0);
    }

    // ---------------------------------------------------------------------
    // Principal-only emergency exit
    // ---------------------------------------------------------------------

    function test_emergencyWithdraw_returnsPrincipalAndForfeitsRewards() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 100);
        assertGt(staking.pendingReward(alice), 0);

        uint256 balBefore = leo.balanceOf(alice);
        uint256 mintedBefore = leo.emissionMinted();

        vm.prank(alice);
        staking.emergencyWithdraw();

        assertEq(leo.balanceOf(alice), balBefore + 10 ether);
        assertEq(leo.emissionMinted(), mintedBefore);
        (uint256 amount, uint256 debt, uint256 rewards) = staking.users(alice);
        assertEq(amount, 0);
        assertEq(debt, 0);
        assertEq(rewards, 0);
    }

    function test_emergencyWithdraw_revertsWithoutPosition() public {
        vm.prank(alice);
        vm.expectRevert(Staking.InsufficientStake.selector);
        staking.emergencyWithdraw();
    }

    // ---------------------------------------------------------------------
    // Schedule
    // ---------------------------------------------------------------------

    function test_currentEpoch_andHalving_matchesTimeSchedule() public {
        _startEmission();
        assertEq(staking.currentEpoch(), 0);
        vm.warp(block.timestamp + HALVING_PERIOD);
        assertEq(staking.currentEpoch(), 1);
        assertEq(staking.currentEmissionPerSecond(), (staking.FIRST_EPOCH_EMISSION() >> 1) / HALVING_PERIOD);
    }

    function test_scheduledEmission_neverExceedsTotal() public view {
        uint256 farFuture = staking.startTime() + 300 * HALVING_PERIOD;
        assertLe(staking.scheduledEmission(farFuture), staking.TOTAL_EMISSION());
        assertApproxEqAbs(staking.scheduledEmission(farFuture), staking.TOTAL_EMISSION(), 1e6);
    }

    function test_scheduledEmission_isMonotonic() public view {
        uint256 start = staking.startTime();
        uint256 prev;
        for (uint256 t = start; t < start + 5 * HALVING_PERIOD; t += 137) {
            uint256 s = staking.scheduledEmission(t);
            assertGe(s, prev);
            prev = s;
        }
    }

    function test_emissionBetween_matchesScheduleDifference() public view {
        uint256 a = staking.startTime() + 500;
        uint256 b = staking.startTime() + 2500;
        assertEq(staking.emissionBetween(a, b), staking.scheduledEmission(b) - staking.scheduledEmission(a));
        assertEq(staking.emissionBetween(b, a), 0);
        assertEq(staking.emissionBetween(0, staking.startTime()), 0);
    }

    function test_currentEmissionPerSecond_zeroPastMaxEpochs() public {
        _startEmission();
        vm.warp(block.timestamp + staking.MAX_EPOCHS() * HALVING_PERIOD);
        assertEq(staking.currentEmissionPerSecond(), 0);
    }

    function test_previewIndex_flatAfterEmissionFullyExhausted() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 120 * HALVING_PERIOD);
        vm.prank(alice);
        staking.claim();

        uint256 indexBefore = staking.previewIndex();
        vm.warp(block.timestamp + 1000);
        assertEq(staking.previewIndex(), indexBefore);
    }

    function test_schedule_ignoresBlockCount() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.roll(block.number + HALVING_PERIOD * 50);
        assertEq(staking.pendingReward(alice), 0);
        assertEq(staking.currentEpoch(), 0);
        assertEq(staking.nextHalvingTime(), staking.startTime() + HALVING_PERIOD);
    }

    function test_schedule_halvingsLandExactlyOnPeriodBoundaries() public {
        uint256 start = staking.startTime();
        for (uint256 epoch = 0; epoch < 10; epoch++) {
            vm.warp(start + epoch * HALVING_PERIOD + HALVING_PERIOD - 1);
            assertEq(staking.currentEpoch(), epoch);
            assertEq(staking.currentEmissionPerSecond(), (staking.FIRST_EPOCH_EMISSION() >> epoch) / HALVING_PERIOD);
            vm.warp(start + (epoch + 1) * HALVING_PERIOD);
            assertEq(staking.currentEpoch(), epoch + 1);
            assertEq(staking.nextHalvingTime(), start + (epoch + 2) * HALVING_PERIOD);
        }
    }

    /// @dev Real deployment value: 4 years in seconds. A full first epoch emits
    /// FIRST_EPOCH_EMISSION in total, 2.1M LEO to each of the five buckets.
    function test_schedule_realFourYearPeriod_firstEpochEmitsExpectedTotal() public {
        uint256 fourYears = 126_230_400; // 4 * 365.25 days
        Staking realStaking = new Staking(address(leo), fourYears, _recipients(), DELAY);
        uint256 start = realStaking.startTime();
        assertEq(realStaking.scheduledEmission(start + fourYears), realStaking.FIRST_EPOCH_EMISSION());
        vm.warp(start + fourYears);
        assertEq(realStaking.bucketClaimable(Staking.Bucket.Builder), 2_100_000 ether);
    }

    function test_emittedSupply_tracksGenesisPlusClaimableEmission() public {
        _stake(alice, 10 ether);
        _startEmission();
        vm.warp(block.timestamp + 400);
        uint256 scheduled = staking.scheduledEmission(block.timestamp);
        assertApproxEqAbs(staking.emittedSupply(), leo.GENESIS_ALLOCATION() + scheduled, 10);
        assertEq(leo.emittedSupply(), staking.emittedSupply());
    }

    // ---------------------------------------------------------------------
    // Full lifetime: every bucket + stakers fully claimed, cap holds
    // ---------------------------------------------------------------------

    function test_fullLifetime_everythingClaimed_neverExceedsCap() public {
        _stake(alice, 10 ether);
        _stake(bob, 7 ether);
        _startEmission();
        vm.warp(block.timestamp + 300 * HALVING_PERIOD);

        vm.prank(alice);
        staking.unstake(10 ether);
        vm.prank(bob);
        staking.unstake(7 ether);
        address[4] memory r = _recipients();
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(r[i]);
            staking.claimBucket(Staking.Bucket(i));
        }

        assertLe(leo.emissionMinted(), leo.EMISSION_ALLOCATION());
        assertLe(leo.totalSupply(), leo.MAX_SUPPLY());
        assertApproxEqAbs(leo.totalSupply(), leo.MAX_SUPPLY(), 1e6);
    }
}
