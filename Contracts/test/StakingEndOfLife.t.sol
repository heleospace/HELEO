// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../LEO.sol";
import {Staking} from "../Staking.sol";

/// @dev End-of-life regression. Runs 40 full-lifetime scenarios (5 stakers mixing
/// stake / compound / partial unstake / claim with odd amounts) all the way past
/// emission exhaustion, with every ecosystem bucket also claiming in full, then
/// has every staker fully exit. Exits must never revert.
contract StakingEndOfLifeTest is Test {
    address[] users;
    address[4] recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];

    function _deploy() internal returns (LEO leo, Staking staking) {
        address[9] memory contributors;
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0xA000 + i));
        if (users.length == 0) for (uint256 i = 0; i < 5; i++) users.push(contributors[i]);
        leo = new LEO(contributors);
        staking = new Staking(address(leo), 37, recipients);
        leo.setStaking(address(staking));
        vm.warp(staking.startTime());
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(users[i]);
            leo.approve(address(staking), type(uint256).max);
        }
    }

    function test_endOfEmission_everyStakerCanAlwaysExit() public {
        for (uint256 s = 0; s < 40; s++) {
            (LEO leo, Staking staking) = _deploy();

            for (uint256 r = 0; r < 40; r++) {
                for (uint256 i = 0; i < users.length; i++) {
                    address u = users[i];
                    uint256 action = (r * 7 + i * 13 + s * 3) % 4;
                    vm.startPrank(u);
                    if (action == 0) {
                        uint256 amt = 1 ether + ((s + 1) * (r + 3) * (i + 5) * 1_000_003_331) % 1 ether;
                        if (leo.balanceOf(u) >= amt) try staking.stake(amt) {} catch {}
                    } else if (action == 1) {
                        try staking.compound() {} catch {}
                    } else if (action == 2) {
                        (uint256 a,,) = staking.users(u);
                        if (a > 2 ether) try staking.unstake(a / 3 + s + r) {} catch {}
                    } else {
                        try staking.claim() {} catch {}
                    }
                    vm.stopPrank();
                }
                vm.warp(block.timestamp + 3 + ((r + s) % 5));
            }

            vm.warp(block.timestamp + 100_000); // far past the end of the schedule
            vm.prank(users[0]);
            try staking.claim() {} catch {}

            // Buckets claim their full share first, leaving stakers to hit the cap.
            for (uint256 i = 0; i < 4; i++) {
                vm.prank(recipients[i]);
                try staking.claimBucket(Staking.Bucket(i)) {} catch {}
            }

            for (uint256 i = 0; i < users.length; i++) {
                (uint256 a,,) = staking.users(users[i]);
                if (a == 0) continue;
                vm.prank(users[i]);
                staking.unstake(a); // must never revert
            }

            assertEq(staking.totalStaked(), 0);
            assertLe(leo.emissionMinted(), leo.EMISSION_ALLOCATION());
            assertLe(leo.totalSupply(), leo.MAX_SUPPLY());
        }
    }
}
