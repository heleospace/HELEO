// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LEO} from "../LEO.sol";

contract LEOTest is Test {
    LEO leo;
    address[9] contributors;
    address staking = address(0x5747);

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x1000 + i));
        leo = new LEO(contributors);
    }

    function test_metadata() public view {
        assertEq(leo.name(), "HELEO");
        assertEq(leo.symbol(), "LEO");
        assertEq(leo.MAX_SUPPLY(), 42_000_000 ether);
        assertEq(leo.GENESIS_ALLOCATION() + leo.EMISSION_ALLOCATION(), leo.MAX_SUPPLY());
    }

    function test_constructor_mintsGenesisEquallyToNineContributors() public view {
        uint256 share = leo.GENESIS_ALLOCATION() / 9;
        assertEq(leo.totalSupply(), leo.GENESIS_ALLOCATION());
        // contributors[0] also receives the 3 wei integer-division remainder.
        assertEq(leo.balanceOf(contributors[0]), share + 3);
        for (uint256 i = 1; i < 9; i++) assertEq(leo.balanceOf(contributors[i]), share);
    }

    function test_constructor_deployerReceivesNothing() public view {
        assertEq(leo.balanceOf(address(this)), 0);
    }

    function test_constructor_revertsOnZeroContributor() public {
        for (uint256 i = 0; i < 9; i++) {
            address[9] memory c = contributors;
            c[i] = address(0);
            vm.expectRevert(LEO.InvalidAddress.selector);
            new LEO(c);
        }
    }

    function test_constructor_revertsOnDuplicateContributor() public {
        address[9] memory c = contributors;
        c[8] = c[3];
        vm.expectRevert(LEO.DuplicateContributor.selector);
        new LEO(c);
    }

    function test_setStaking_setsOnce() public {
        leo.setStaking(staking);
        assertEq(leo.staking(), staking);
    }

    function test_setStaking_revertsIfAlreadySet() public {
        leo.setStaking(staking);
        vm.expectRevert(LEO.StakingAlreadySet.selector);
        leo.setStaking(address(0xBEEF));
    }

    function test_setStaking_revertsOnZeroAddress() public {
        vm.expectRevert(LEO.InvalidAddress.selector);
        leo.setStaking(address(0));
    }

    function test_setStaking_revertsIfNotOwner() public {
        vm.prank(contributors[0]);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, contributors[0]));
        leo.setStaking(staking);
    }

    function test_mintEmission_onlyStaking() public {
        leo.setStaking(staking);
        vm.expectRevert(LEO.OnlyStaking.selector);
        leo.mintEmission(address(this), 1 ether);
    }

    function test_mintEmission_mintsAndTracks() public {
        leo.setStaking(staking);
        vm.prank(staking);
        leo.mintEmission(address(0xCAFE), 5 ether);
        assertEq(leo.balanceOf(address(0xCAFE)), 5 ether);
        assertEq(leo.emissionMinted(), 5 ether);
        assertEq(leo.remainingEmission(), leo.EMISSION_ALLOCATION() - 5 ether);
    }

    function test_mintEmission_revertsPastEmissionAllocation() public {
        leo.setStaking(staking);
        uint256 cap = leo.EMISSION_ALLOCATION();
        vm.startPrank(staking);
        leo.mintEmission(address(0xCAFE), cap);
        vm.expectRevert(LEO.CapExceeded.selector);
        leo.mintEmission(address(0xCAFE), 1);
        vm.stopPrank();
        assertEq(leo.totalSupply(), leo.MAX_SUPPLY());
    }

    function test_emittedSupply_beforeStakingSet_returnsGenesisAllocation() public view {
        assertEq(leo.emittedSupply(), leo.GENESIS_ALLOCATION());
    }

    function testFuzz_mintEmission_neverExceedsEitherCap(uint256 amount) public {
        leo.setStaking(staking);
        uint256 cap = leo.EMISSION_ALLOCATION();
        vm.prank(staking);
        if (amount > cap) {
            vm.expectRevert(LEO.CapExceeded.selector);
            leo.mintEmission(address(0xCAFE), amount);
        } else {
            leo.mintEmission(address(0xCAFE), amount);
            assertLe(leo.totalSupply(), leo.MAX_SUPPLY());
        }
    }
}
