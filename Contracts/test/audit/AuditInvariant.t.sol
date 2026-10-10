// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LEO} from "../../LEO.sol";
import {Staking} from "../../Staking.sol";
import {StakingInvariantHandler, DELAY} from "../StakingInvariant.t.sol";

/// @dev Audit pass 5: conservation invariants on top of the existing suite.
/// Reuses the existing random-sequence handler (stake/unstake/claim/compound/
/// emergencyWithdraw/claimBucket/warp).
contract AuditInvariantTest is Test {
    LEO leo;
    Staking staking;
    StakingInvariantHandler handler;
    address[] actors;
    address[4] recipients = [address(0xB1), address(0xC0), address(0xC1), address(0xE5)];
    uint256 initialActorBalance;

    function setUp() public {
        address[] memory contributors = new address[](9);
        for (uint256 i = 0; i < 9; i++) contributors[i] = address(uint160(0x9000 + i));
        leo = new LEO(contributors);
        for (uint256 i = 0; i < 5; i++) {
            actors.push(contributors[i]);
            initialActorBalance += leo.balanceOf(contributors[i]);
        }
        staking = new Staking(address(leo), 500, recipients, DELAY);
        leo.setStaking(address(staking));
        handler = new StakingInvariantHandler(leo, staking, actors, recipients);
        targetContract(address(handler));
    }

    function _bucketMinted() internal view returns (uint256 sum) {
        for (uint256 i = 0; i < 4; i++) sum += leo.balanceOf(recipients[i]);
    }

    /// Every LEO is accounted for: actor wallets + staking contract equals the
    /// starting balances plus exactly what was minted to stakers. Nobody ever
    /// receives more than they deposited plus rewards minted for them.
    function invariant_conservationOfLEO() public view {
        uint256 held = leo.balanceOf(address(staking));
        for (uint256 i = 0; i < actors.length; i++) held += leo.balanceOf(actors[i]);
        assertEq(held, initialActorBalance + leo.emissionMinted() - _bucketMinted());
    }

    /// No donations in this run, so the contract holds exactly the staked total:
    /// rewards are never left stranded or borrowed from principal.
    function invariant_balanceEqualsTotalStaked() public view {
        assertEq(leo.balanceOf(address(staking)), staking.totalStaked());
    }

    function invariant_supplyIsGenesisPlusEmission() public view {
        assertEq(leo.totalSupply(), leo.GENESIS_ALLOCATION() + leo.emissionMinted());
    }

    /// Finding I-06: per-settlement floor rounding can credit a staker up to
    /// 1 wei extra, so minted can run a few wei ahead of the schedule (observed:
    /// 1 wei). LEO's hard caps still bind; the tolerance matches the stakers'
    /// invariant below.
    function invariant_mintedNeverAheadOfSchedule() public view {
        assertLe(leo.emissionMinted(), staking.scheduledEmission(block.timestamp) + 1000);
    }

    /// Stakers in aggregate never receive more than the stakers' fifth credited
    /// to the index, apart from per-settlement floor rounding (<= 1 wei each).
    function invariant_stakersNeverPaidBeyondTheirFifth() public view {
        uint256 stakersMinted = leo.emissionMinted() - _bucketMinted();
        assertLe(stakersMinted, staking.stakerEmitted() + 1000);
    }
}
