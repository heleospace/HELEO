// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../LEO.sol";
import {Staking} from "../Staking.sol";

/// @dev Stateful-fuzzing handler: the invariant runner calls these functions in
/// random sequences with random arguments, then checks the invariants below still
/// hold after every call. Reverts from the contract under test are expected and
/// swallowed here (e.g. staking 0, unstaking more than you have) — the point is
/// to keep the sequence going, not to avoid every revert.
contract StakingInvariantHandler is Test {
    LEO public leo;
    Staking public staking;
    address[] public actors;
    address[4] public recipients;

    constructor(LEO _leo, Staking _staking, address[] memory _actors, address[4] memory _recipients) {
        leo = _leo;
        staking = _staking;
        actors = _actors;
        recipients = _recipients;
    }

    // Exits are never allowed to fail silently: a full unstake or emergency
    // withdraw of an existing position has no legitimate reason to revert, so
    // any revert is recorded and fails invariant_exitsNeverRevert.
    uint256 public exitFailures;

    function stake(uint256 actorSeed, uint256 amount) public {
        address who = actors[actorSeed % actors.length];
        uint256 bal = leo.balanceOf(who);
        (uint256 staked,,) = staking.users(who);
        uint256 minAmount = staked == 0 ? staking.MIN_STAKE() : 1;
        if (bal < minAmount) return;
        amount = bound(amount, minAmount, bal);
        vm.startPrank(who);
        leo.approve(address(staking), amount);
        try staking.stake(amount) {} catch {}
        vm.stopPrank();
    }

    function unstake(uint256 actorSeed, uint256 amount) public {
        address who = actors[actorSeed % actors.length];
        (uint256 staked,,) = staking.users(who);
        if (staked == 0) return;
        amount = bound(amount, 1, staked);
        uint256 remaining = staked - amount;
        if (remaining != 0 && remaining < staking.MIN_STAKE()) amount = staked;
        vm.startPrank(who);
        try staking.unstake(amount) {} catch {
            if (amount == staked) exitFailures++;
        }
        vm.stopPrank();
    }

    function emergencyWithdraw(uint256 actorSeed) public {
        address who = actors[actorSeed % actors.length];
        (uint256 staked,,) = staking.users(who);
        if (staked == 0) return;
        vm.startPrank(who);
        try staking.emergencyWithdraw() {} catch {
            exitFailures++;
        }
        vm.stopPrank();
    }

    function claim(uint256 actorSeed) public {
        address who = actors[actorSeed % actors.length];
        vm.startPrank(who);
        try staking.claim() {} catch {}
        vm.stopPrank();
    }

    function compound(uint256 actorSeed) public {
        address who = actors[actorSeed % actors.length];
        vm.startPrank(who);
        try staking.compound() {} catch {}
        vm.stopPrank();
    }

    function claimBucket(uint256 bucketSeed) public {
        uint256 b = bucketSeed % 4;
        vm.startPrank(recipients[b]);
        try staking.claimBucket(Staking.Bucket(b)) {} catch {}
        vm.stopPrank();
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 1, 5000);
        vm.warp(block.timestamp + seconds_);
    }

    function actorCount() public view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) public view returns (address) {
        return actors[i];
    }
}

contract StakingInvariantTest is Test {
    LEO leo;
    Staking staking;
    StakingInvariantHandler handler;
    address[] actors;

    function setUp() public {
        address[9] memory contributors;
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x9000 + i));
        leo = new LEO(contributors);
        for (uint256 i = 0; i < 5; i++) actors.push(contributors[i]);

        address[4] memory recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];
        staking = new Staking(address(leo), 500, recipients);
        leo.setStaking(address(staking));

        handler = new StakingInvariantHandler(leo, staking, actors, recipients);
        targetContract(address(handler));
    }

    /// @dev Sum of every user's recorded stake must always equal totalStaked —
    /// no accounting drift across any sequence of stake/unstake/compound calls.
    function invariant_totalStakedMatchesSumOfUsers() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            (uint256 amount,,) = staking.users(handler.actorAt(i));
            sum += amount;
        }
        assertEq(sum, staking.totalStaked());
    }

    /// @dev The contract must always hold enough LEO to cover every staker's
    /// principal — it can never become insolvent for what users are owed back.
    function invariant_contractSolventForPrincipal() public view {
        assertGe(leo.balanceOf(address(staking)), staking.totalStaked());
    }

    /// @dev Stakers' credited + forfeited share can never exceed one fifth of
    /// the schedule, and each bucket can never claim more than its fifth.
    function invariant_fiveWaySplitNeverExceedsSchedule() public view {
        uint256 fifth = staking.scheduledEmission(block.timestamp) / staking.BUCKET_COUNT();
        assertLe(staking.stakerEmitted() + staking.stakerForfeited(), fifth);
        for (uint256 i = 0; i < 4; i++) assertLe(staking.bucketClaimed(i), fifth);
    }

    /// @dev LEO's own hard caps must hold regardless of what Staking does.
    function invariant_leoSupplyNeverExceedsMaxSupply() public view {
        assertLe(leo.totalSupply(), leo.MAX_SUPPLY());
        assertLe(leo.emissionMinted(), leo.EMISSION_ALLOCATION());
    }

    /// @dev no position can ever sit between 0 and MIN_STAKE, which is
    /// what keeps accRewardPerShare bounded for the contract's whole life.
    function invariant_positionsAreZeroOrAboveMinimum() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            (uint256 amount,,) = staking.users(handler.actorAt(i));
            assertTrue(amount == 0 || amount >= staking.MIN_STAKE());
        }
    }

    /// @dev a staker can always get their principal back, via a full
    /// unstake or the emergency exit, at any point in any random sequence.
    function invariant_exitsNeverRevert() public view {
        assertEq(handler.exitFailures(), 0);
    }
}
