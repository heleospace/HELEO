// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LEO} from "../../LEO.sol";
import {Staking} from "../../Staking.sol";

/// @dev Audit passes 1-2: who can mint, who can change time or supply.
contract AuditAccessTest is Test {
    LEO leo;
    Staking staking;
    address[] contributors;
    address[4] recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors.push(address(uint160(0x9000 + i)));
        leo = new LEO(contributors);
        staking = new Staking(address(leo), 126_230_400, recipients, 24 hours);
        leo.setStaking(address(staking));
    }

    function testFuzz_onlyStakingCanMint(address caller, uint256 amount) public {
        vm.assume(caller != address(staking));
        vm.prank(caller);
        vm.expectRevert(LEO.OnlyStaking.selector);
        leo.mintEmission(caller, amount);
    }

    function test_setStakingIsOneShotEvenForFormerOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        leo.setStaking(address(0xBAD));
        assertEq(leo.staking(), address(staking));
    }

    function testFuzz_setStakingOnlyOwner(address attacker) public {
        LEO fresh = new LEO(contributors);
        vm.assume(attacker != address(this));
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        fresh.setStaking(attacker);
    }

    /// L-01 fix: wiring Staking renounces ownership in the same transaction, so
    /// no admin key survives setup.
    function test_setStakingLeavesNoOwner() public view {
        assertEq(leo.owner(), address(0));
    }

    function test_mainnetForces24hDelay() public {
        vm.chainId(1);
        vm.expectRevert(Staking.InvalidEmissionDelay.selector);
        new Staking(address(leo), 126_230_400, recipients, 5 minutes);
        Staking ok = new Staking(address(leo), 126_230_400, recipients, 24 hours);
        assertEq(ok.startTime(), block.timestamp + 24 hours);
    }

    function test_scheduleIsPureFunctionOfTime() public {
        uint256 t = staking.startTime() + 1000 days;
        uint256 before = staking.scheduledEmission(t);
        // Unrelated state changes (stakes, donations, bucket claims) never move it.
        vm.startPrank(contributors[1]);
        leo.approve(address(staking), 100 ether);
        staking.stake(100 ether);
        leo.transfer(address(staking), 5 ether);
        vm.stopPrank();
        vm.warp(staking.startTime() + 10 days);
        vm.prank(recipients[0]);
        staking.claimBucket(Staking.Bucket.Builder);
        assertEq(staking.scheduledEmission(t), before);
    }

    // ---- Findings (proof of concept) --------------------------------------

    /// M-01 fix: mainnet rejects any halving period other than 4 years, so a
    /// deploy typo can no longer release the emission early.
    function testFuzz_FIXED_M01_mainnetPinsHalvingPeriod(uint256 period) public {
        vm.chainId(1);
        vm.assume(period != 126_230_400);
        vm.expectRevert(Staking.InvalidHalvingPeriod.selector);
        new Staking(address(leo), period, recipients, 24 hours);
        Staking ok = new Staking(address(leo), 126_230_400, recipients, 24 hours);
        assertEq(ok.halvingPeriod(), 126_230_400);
    }

    /// L-01 (residual, accepted): before setStaking the deployer still chooses
    /// the minter. Once set, ownership is gone, so the choice is final and
    /// publicly checkable: LEO.staking() must equal the verified Staking.
    function test_L01_minterChoiceIsFinalAfterSetStaking() public {
        LEO l = new LEO(contributors);
        address rogue = address(0xBEEF);
        l.setStaking(rogue);
        assertEq(l.owner(), address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        l.setStaking(address(0xCAFE));
    }

    /// L-02 fix: a Staking contract that LEO is not wired to refuses deposits,
    /// so a copycat can never trap funds behind rewards it cannot pay.
    function test_FIXED_L02_unwiredStakingRefusesDeposits() public {
        Staking impostor = new Staking(address(leo), 126_230_400, recipients, 24 hours);
        address user = contributors[3];
        uint256 bal = leo.balanceOf(user);
        vm.startPrank(user);
        leo.approve(address(impostor), 10 ether);
        vm.expectRevert(Staking.NotWiredMinter.selector);
        impostor.stake(10 ether);
        vm.stopPrank();
        assertEq(leo.balanceOf(user), bal);
    }

    /// The canonical contract only opens once setStaking() has wired it.
    function test_stakingOpensOnlyAfterWiring() public {
        LEO l = new LEO(contributors);
        Staking s = new Staking(address(l), 126_230_400, recipients, 24 hours);
        vm.startPrank(contributors[3]);
        l.approve(address(s), 10 ether);
        vm.expectRevert(Staking.NotWiredMinter.selector);
        s.stake(10 ether);
        vm.stopPrank();

        l.setStaking(address(s));
        vm.prank(contributors[3]);
        s.stake(10 ether);
        assertEq(s.totalStaked(), 10 ether);
    }
}
