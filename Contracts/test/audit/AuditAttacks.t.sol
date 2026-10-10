// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../../LEO.sol";
import {Staking} from "../../Staking.sol";

/// @dev Audit pass 4: attack catalogue against user funds and rewards.
contract AuditAttacksTest is Test {
    uint256 constant P = 126_230_400;
    LEO leo;
    Staking staking;
    address[9] contributors;
    address[4] recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];
    address alice;
    address bob;
    address carol;
    address attacker = address(0xA77AC);
    uint256 start;

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x9000 + i));
        leo = new LEO(contributors);
        staking = new Staking(address(leo), P, recipients, 24 hours);
        leo.setStaking(address(staking));
        start = staking.startTime();
        (alice, bob, carol) = (contributors[1], contributors[2], contributors[3]);
        vm.prank(contributors[4]);
        leo.transfer(attacker, 1_000_000 ether);
    }

    function _stake(address who, uint256 amount) internal {
        vm.startPrank(who);
        leo.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// Whale stakes right before Alice claims: cannot touch emission that
    /// accrued before the whale arrived.
    function test_justInTimeStakeCapturesNothingPast() public {
        _stake(alice, 10 ether);
        vm.warp(start + 30 days);
        uint256 aliceOwed = staking.pendingReward(alice);
        _stake(attacker, 1_000_000 ether);
        assertEq(staking.pendingReward(attacker), 0);
        assertEq(staking.pendingReward(alice), aliceOwed);
    }

    /// emergencyWithdraw skips _update; a whale staking right after must still
    /// not capture the un-indexed window — stake() indexes it first.
    function test_justInTimeAfterEmergencyWithdraw() public {
        _stake(alice, 10 ether);
        _stake(carol, 10 ether);
        vm.warp(start + 30 days);
        uint256 window = staking.scheduledEmission(block.timestamp) / 5;
        vm.prank(carol);
        staking.emergencyWithdraw();
        _stake(attacker, 1_000_000 ether);
        assertEq(staking.pendingReward(attacker), 0);
        // Carol's forfeited half of the window went to Alice, as documented.
        assertApproxEqAbs(staking.pendingReward(alice), window, 2);
    }

    function test_noDoubleClaimAcrossPaths() public {
        _stake(alice, 10 ether);
        vm.warp(start + 10 days);
        vm.startPrank(alice);
        staking.claim();
        vm.expectRevert(Staking.NoReward.selector);
        staking.claim();
        vm.expectRevert(Staking.NoReward.selector);
        staking.compound();
        uint256 bal = leo.balanceOf(alice);
        uint256 reward = staking.unstake(10 ether);
        vm.stopPrank();
        assertEq(reward, 0);
        assertEq(leo.balanceOf(alice) - bal, 10 ether);
    }

    /// Splitting an exit into many partial unstakes never pays more than one
    /// full unstake would.
    function testFuzz_partialUnstakesNeverOverpay(uint8 pieces) public {
        uint256 n = bound(pieces, 2, 20);
        _stake(alice, 100 ether);
        _stake(bob, 100 ether);
        vm.warp(start + 100 days);

        uint256 aBefore = leo.balanceOf(alice);
        vm.startPrank(alice);
        for (uint256 i = 0; i < n - 1; i++) staking.unstake(100 ether / n);
        (uint256 left,,) = staking.users(alice);
        staking.unstake(left);
        vm.stopPrank();
        uint256 aliceGot = leo.balanceOf(alice) - aBefore - 100 ether;

        uint256 bBefore = leo.balanceOf(bob);
        vm.prank(bob);
        staking.unstake(100 ether);
        uint256 bobGot = leo.balanceOf(bob) - bBefore - 100 ether;

        assertLe(aliceGot, bobGot);
        assertApproxEqAbs(aliceGot, bobGot, n);
    }

    function test_emergencyThenRestakeKeepsNoOldRewards() public {
        _stake(alice, 10 ether);
        vm.warp(start + 10 days);
        vm.startPrank(alice);
        staking.emergencyWithdraw();
        leo.approve(address(staking), 10 ether);
        staking.stake(10 ether);
        vm.stopPrank();
        assertEq(staking.pendingReward(alice), 0);
    }

    function test_donationDoesNotChangeRewards() public {
        _stake(alice, 10 ether);
        vm.warp(start + 10 days);
        uint256 owed = staking.pendingReward(alice);
        uint256 index = staking.previewIndex();
        vm.prank(attacker);
        leo.transfer(address(staking), 500_000 ether);
        assertEq(staking.pendingReward(alice), owed);
        assertEq(staking.previewIndex(), index);
        assertEq(staking.totalStaked(), 10 ether);
    }

    /// Smallest possible stake cannot inflate the index enough to overflow
    /// later full-supply positions.
    function test_minStakeCannotBrickWithOverflow() public {
        vm.startPrank(attacker);
        leo.approve(address(staking), 1 ether);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.stake(1 ether - 1);
        staking.stake(1 ether);
        vm.stopPrank();
        vm.warp(start + 100 * P); // attacker alone for the whole emission
        _stake(alice, 2_000_000 ether);
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        staking.unstake(2_000_000 ether);
        vm.prank(attacker);
        staking.unstake(1 ether);
    }

    function test_cannotLeaveDustPosition() public {
        _stake(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(Staking.BelowMinimumStake.selector);
        staking.unstake(10 ether - 1);
    }

    function testFuzz_strangerCannotTouchBuckets(address stranger, uint8 b) public {
        Staking.Bucket bucket = Staking.Bucket(bound(b, 0, 3));
        for (uint256 i = 0; i < 4; i++) vm.assume(stranger != recipients[i]);
        vm.assume(stranger != address(0));
        vm.warp(start + 10 days);
        vm.startPrank(stranger);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(bucket);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.proposeBucketRecipient(bucket, stranger);
        vm.expectRevert(Staking.NotPendingRecipient.selector);
        staking.acceptBucketRecipient(bucket);
        vm.stopPrank();
    }

    function test_bucketHandoverMovesAccruedOnce() public {
        address next = address(0x1234);
        vm.warp(start + 10 days);
        uint256 accrued = staking.bucketClaimable(Staking.Bucket.Coder);
        vm.prank(recipients[1]);
        staking.proposeBucketRecipient(Staking.Bucket.Coder, next);
        // Pending recipient has no rights before accepting.
        vm.prank(next);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(Staking.Bucket.Coder);
        vm.prank(next);
        staking.acceptBucketRecipient(Staking.Bucket.Coder);
        // Old recipient lost all rights.
        vm.prank(recipients[1]);
        vm.expectRevert(Staking.NotBucketRecipient.selector);
        staking.claimBucket(Staking.Bucket.Coder);
        vm.prank(next);
        assertEq(staking.claimBucket(Staking.Bucket.Coder), accrued);
        vm.prank(next);
        vm.expectRevert(Staking.NoReward.selector);
        staking.claimBucket(Staking.Bucket.Coder);
    }

    /// Bucket claims can never eat into what stakers are owed.
    function test_bucketsCannotStarveStakers() public {
        _stake(alice, 10 ether);
        vm.warp(start + 200 * P);
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(recipients[i]);
            staking.claimBucket(Staking.Bucket(i));
        }
        uint256 owed = staking.pendingReward(alice);
        uint256 bal = leo.balanceOf(alice);
        vm.prank(alice);
        staking.unstake(10 ether);
        assertEq(leo.balanceOf(alice) - bal, 10 ether + owed);
    }

    function test_stakingBeforeStartEarnsNothingEarly() public {
        _stake(alice, 10 ether);
        vm.warp(start);
        assertEq(staking.pendingReward(alice), 0);
        vm.prank(alice);
        vm.expectRevert(Staking.NoReward.selector);
        staking.claim();
    }
}
