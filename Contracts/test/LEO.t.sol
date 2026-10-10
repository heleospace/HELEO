// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LEO} from "../LEO.sol";

contract LEOTest is Test {
    LEO leo;
    address[] contributors;
    address staking = address(0x5747);

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) contributors.push(address(uint160(0x1000 + i)));
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

    function _wallets(uint256 n) internal pure returns (address[] memory w) {
        w = new address[](n);
        for (uint256 i = 0; i < n; i++) w[i] = address(uint160(0x5000 + i));
    }

    function test_constructor_recordsContributorCount() public view {
        assertEq(leo.contributorCount(), 9);
        assertEq(leo.MAX_CONTRIBUTORS(), 21);
    }

    /// Any count from 1 to 21: every wallet gets an equal share, the first also
    /// gets the remainder (fewer wei than wallets), and exactly 21M is minted.
    function testFuzz_constructor_splitsExactlyForAnyCount(uint256 n) public {
        n = bound(n, 1, 21);
        address[] memory w = _wallets(n);
        LEO l = new LEO(w);
        uint256 share = l.GENESIS_ALLOCATION() / n;
        uint256 remainder = l.GENESIS_ALLOCATION() - share * n;
        assertLt(remainder, n);
        assertEq(l.contributorCount(), n);
        assertEq(l.balanceOf(w[0]), share + remainder);
        uint256 sum = l.balanceOf(w[0]);
        for (uint256 i = 1; i < n; i++) {
            assertEq(l.balanceOf(w[i]), share);
            sum += l.balanceOf(w[i]);
        }
        assertEq(sum, l.GENESIS_ALLOCATION());
        assertEq(l.totalSupply(), l.GENESIS_ALLOCATION());
    }

    function test_constructor_singleContributorGetsAll() public {
        address[] memory w = _wallets(1);
        LEO l = new LEO(w);
        assertEq(l.balanceOf(w[0]), 21_000_000 ether);
    }

    function test_constructor_twentyOneContributorsGetOneMillionEach() public {
        address[] memory w = _wallets(21);
        LEO l = new LEO(w);
        for (uint256 i = 0; i < 21; i++) assertEq(l.balanceOf(w[i]), 1_000_000 ether);
    }

    function test_constructor_revertsOnZeroContributors() public {
        vm.expectRevert(LEO.InvalidContributorCount.selector);
        new LEO(new address[](0));
    }

    function test_constructor_revertsOnMoreThanTwentyOne() public {
        address[] memory w = _wallets(22);
        vm.expectRevert(LEO.InvalidContributorCount.selector);
        new LEO(w);
    }

    function test_constructor_revertsOnDuplicateAtLastOfTwentyOne() public {
        address[] memory w = _wallets(21);
        w[20] = w[0];
        vm.expectRevert(LEO.DuplicateContributor.selector);
        new LEO(w);
    }

    function test_constructor_deployerReceivesNothing() public view {
        assertEq(leo.balanceOf(address(this)), 0);
    }

    function test_constructor_revertsOnZeroContributor() public {
        for (uint256 i = 0; i < 9; i++) {
            address[] memory c = contributors;
            c[i] = address(0);
            vm.expectRevert(LEO.InvalidAddress.selector);
            new LEO(c);
        }
    }

    function test_constructor_revertsOnDuplicateContributor() public {
        address[] memory c = contributors;
        c[8] = c[3];
        vm.expectRevert(LEO.DuplicateContributor.selector);
        new LEO(c);
    }

    function test_setStaking_setsOnce() public {
        leo.setStaking(staking);
        assertEq(leo.staking(), staking);
    }

    function test_setStaking_renouncesOwnership() public {
        assertEq(leo.owner(), address(this));
        leo.setStaking(staking);
        assertEq(leo.owner(), address(0));
    }

    /// Ownership is gone after the first call, so even the former owner is
    /// rejected before StakingAlreadySet is reached.
    function test_setStaking_revertsIfAlreadySet() public {
        leo.setStaking(staking);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        leo.setStaking(address(0xBEEF));
        assertEq(leo.staking(), staking);
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
