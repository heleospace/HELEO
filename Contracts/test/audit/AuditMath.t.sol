// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../../LEO.sol";
import {Staking} from "../../Staking.sol";

/// @dev Audit pass 3: the distribution math matches the design exactly.
/// Expected values were computed independently (Python, arbitrary precision).
contract AuditMathTest is Test {
    uint256 constant P = 126_230_400; // 4 years of 365.25 days
    uint256 constant E0 = 10_500_000 ether;
    // sum_{e=0..83} floor(E0 / 2^e); epoch 84 onward emits 0.
    uint256 constant SCHEDULE_TOTAL = 21_000_000 ether - 38;
    uint256 constant GENESIS_SHARE = 2_333_333_333_333_333_333_333_333;

    LEO leo;
    Staking staking;
    address[9] contributors;
    address[4] recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];
    uint256 start;

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x9000 + i));
        leo = new LEO(contributors);
        staking = new Staking(address(leo), P, recipients, 24 hours);
        leo.setStaking(address(staking));
        start = staking.startTime();
    }

    function _stake(address who, uint256 amount) internal {
        vm.startPrank(who);
        leo.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    // ---- Genesis -------------------------------------------------------

    function test_genesisSplitIsExact() public view {
        assertEq(leo.balanceOf(contributors[0]), GENESIS_SHARE + 3);
        for (uint256 i = 1; i < 9; i++) assertEq(leo.balanceOf(contributors[i]), GENESIS_SHARE);
        assertEq(leo.totalSupply(), 21_000_000 ether);
        assertEq(leo.emissionMinted(), 0);
    }

    // ---- Halving schedule ---------------------------------------------

    function test_epochCumulativesMatchDesign() public view {
        assertEq(staking.scheduledEmission(start), 0);
        assertEq(staking.scheduledEmission(start + P), 10_500_000 ether);
        assertEq(staking.scheduledEmission(start + 2 * P), 15_750_000 ether);
        assertEq(staking.scheduledEmission(start + 3 * P), 18_375_000 ether);
        assertEq(staking.scheduledEmission(start + 4 * P), 19_687_500 ether);
        assertEq(staking.scheduledEmission(start + P / 2), 5_250_000 ether);
    }

    function test_scheduleEndsAtExactTotalWithin38Wei() public view {
        assertEq(staking.scheduledEmission(start + 84 * P), SCHEDULE_TOTAL);
        assertEq(staking.scheduledEmission(start + 256 * P), SCHEDULE_TOTAL);
        assertEq(staking.scheduledEmission(type(uint64).max), SCHEDULE_TOTAL);
        assertLe(SCHEDULE_TOTAL, staking.TOTAL_EMISSION());
    }

    function testFuzz_scheduleIsMonotonic(uint256 a, uint256 b) public view {
        a = bound(a, 0, start + 100 * P);
        b = bound(b, a, start + 100 * P);
        assertLe(staking.scheduledEmission(a), staking.scheduledEmission(b));
    }

    /// @dev No jump at a halving boundary: the last second of an epoch and the
    /// first second of the next differ by at most one second of emission + 1 wei.
    function testFuzz_scheduleContinuousAtHalving(uint8 epoch) public view {
        uint256 e = bound(epoch, 0, 90);
        uint256 t = start + (e + 1) * P;
        uint256 jump = staking.scheduledEmission(t) - staking.scheduledEmission(t - 1);
        assertLe(jump, (E0 >> e) / P + 1);
    }

    function testFuzz_emissionBetweenIsAdditive(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, start, start + 100 * P);
        b = bound(b, a, start + 100 * P);
        c = bound(c, b, start + 100 * P);
        assertEq(staking.emissionBetween(a, c), staking.emissionBetween(a, b) + staking.emissionBetween(b, c));
    }

    // ---- Five-way split ---------------------------------------------------

    function testFuzz_soleStakerGetsExactlyOneFifth(uint256 amount, uint256 dt) public {
        amount = bound(amount, 1 ether, GENESIS_SHARE);
        dt = bound(dt, 1, 90 * P);
        _stake(contributors[1], amount);
        vm.warp(start + dt);

        uint256 fifth = staking.scheduledEmission(block.timestamp) / 5;
        uint256 pending = staking.pendingReward(contributors[1]);
        assertLe(pending, fifth);
        assertApproxEqAbs(pending, fifth, 2);

        uint256 before = leo.balanceOf(contributors[1]);
        vm.prank(contributors[1]);
        staking.claim();
        assertEq(leo.balanceOf(contributors[1]) - before, pending);
    }

    function testFuzz_twoStakersSplitProRata(uint256 a, uint256 b, uint256 dt) public {
        a = bound(a, 1 ether, GENESIS_SHARE);
        b = bound(b, 1 ether, GENESIS_SHARE);
        dt = bound(dt, 1, 10 * P);
        _stake(contributors[1], a);
        _stake(contributors[2], b);
        vm.warp(start + dt);

        uint256 fifth = staking.scheduledEmission(block.timestamp) / 5;
        uint256 rA = staking.pendingReward(contributors[1]);
        uint256 rB = staking.pendingReward(contributors[2]);
        assertLe(rA + rB, fifth);
        assertApproxEqAbs(rA, fifth * a / (a + b), 2);
        assertApproxEqAbs(rB, fifth * b / (a + b), 2);
    }

    function testFuzz_eachBucketGetsExactlyOneFifth(uint256 dt) public {
        dt = bound(dt, 1, 100 * P);
        vm.warp(start + dt);
        uint256 fifth = staking.scheduledEmission(block.timestamp) / 5;
        for (uint256 i = 0; i < 4; i++) {
            if (fifth == 0) break;
            vm.prank(recipients[i]);
            staking.claimBucket(Staking.Bucket(i));
            assertEq(leo.balanceOf(recipients[i]), fifth);
        }
    }

    /// @dev Full 100-epoch lifecycle with stakers present throughout and
    /// periodic claims: everything adds up, nothing exceeds a cap, and the
    /// unminted remainder is only rounding dust.
    function test_fullLifecycleConservation() public {
        _stake(contributors[1], 1_000_000 ether);
        _stake(contributors[2], 3 ether);

        for (uint256 e = 1; e <= 100; e++) {
            vm.warp(start + e * P);
            // Late epochs emit only wei, so the small staker's share rounds to 0 there.
            if (e % 7 == 0 && e <= 35) {
                vm.prank(contributors[2]);
                staking.compound();
            }
            if (e % 11 == 0) {
                vm.prank(recipients[e % 4]);
                try staking.claimBucket(Staking.Bucket(e % 4)) {} catch {}
            }
        }

        vm.startPrank(contributors[1]);
        staking.unstake(1_000_000 ether);
        vm.stopPrank();
        (uint256 c2,,) = staking.users(contributors[2]);
        vm.prank(contributors[2]);
        staking.unstake(c2);
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(recipients[i]);
            try staking.claimBucket(Staking.Bucket(i)) {} catch {}
            assertEq(leo.balanceOf(recipients[i]), SCHEDULE_TOTAL / 5);
        }

        assertEq(staking.totalStaked(), 0);
        assertEq(leo.balanceOf(address(staking)), 0);
        assertLe(leo.totalSupply(), leo.MAX_SUPPLY());
        assertEq(leo.totalSupply(), 21_000_000 ether + leo.emissionMinted());
        // Unminted remainder: 38 wei schedule dust + sub-5-wei split remainder +
        // per-user floor rounding. Bound it at 100 wei.
        assertGe(leo.emissionMinted(), 21_000_000 ether - 100);
        assertEq(staking.stakerForfeited(), 0);
    }
}
