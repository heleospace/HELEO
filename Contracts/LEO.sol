// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IStakingSupply {
    function emittedSupply() external view returns (uint256);
}

/// @notice HELEO (LEO) fixed-cap token.
/// The 21,000,000 LEO genesis allocation is minted at deploy, split equally across
/// 1 to 21 contributor wallets. The other 21,000,000 LEO (EMISSION_ALLOCATION) can
/// only be minted by the Staking contract over the halving schedule. No public mint
/// exists.
contract LEO is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 42_000_000 ether;
    uint256 public constant GENESIS_ALLOCATION = 21_000_000 ether;
    uint256 public constant EMISSION_ALLOCATION = 21_000_000 ether;
    uint256 public constant MAX_CONTRIBUTORS = 21;

    /// @notice Number of genesis contributor wallets (1 to MAX_CONTRIBUTORS).
    uint256 public immutable contributorCount;

    address public staking;
    uint256 public emissionMinted;

    error InvalidAddress();
    error InvalidContributorCount();
    error DuplicateContributor();
    error StakingAlreadySet();
    error OnlyStaking();
    error CapExceeded();

    /// @param contributors 1 to MAX_CONTRIBUTORS distinct, non-zero wallets. Each
    /// receives GENESIS_ALLOCATION / contributors.length; the integer-division
    /// remainder (fewer wei than there are contributors, at most 13) goes to
    /// contributors[0] so exactly GENESIS_ALLOCATION is minted.
    constructor(address[] memory contributors) ERC20("HELEO", "LEO") Ownable(msg.sender) {
        uint256 count = contributors.length;
        if (count == 0 || count > MAX_CONTRIBUTORS) revert InvalidContributorCount();
        contributorCount = count;
        uint256 share = GENESIS_ALLOCATION / count;
        for (uint256 i = 0; i < count; ++i) {
            if (contributors[i] == address(0)) revert InvalidAddress();
            for (uint256 j = 0; j < i; ++j) {
                if (contributors[j] == contributors[i]) revert DuplicateContributor();
            }
            _mint(contributors[i], share);
        }
        _mint(contributors[0], GENESIS_ALLOCATION - share * count);
    }

    /// @dev One-time, irreversible wiring — there is no way to change `staking`
    /// once set. setStaking() is the owner's only privileged function, so it
    /// renounces ownership in the same transaction: owner() is the zero address
    /// from then on and no admin key is left behind as an attack surface.
    function setStaking(address staking_) external onlyOwner {
        if (staking_ == address(0)) revert InvalidAddress();
        if (staking != address(0)) revert StakingAlreadySet();
        staking = staking_;
        _transferOwnership(address(0));
    }

    /// @notice Mints emission for stakers and the four ecosystem buckets.
    function mintEmission(address to, uint256 amount) external {
        if (msg.sender != staking) revert OnlyStaking();
        if (emissionMinted + amount > EMISSION_ALLOCATION) revert CapExceeded();
        if (totalSupply() + amount > MAX_SUPPLY) revert CapExceeded();
        emissionMinted += amount;
        _mint(to, amount);
    }

    function remainingEmission() external view returns (uint256) {
        return EMISSION_ALLOCATION - emissionMinted;
    }

    /// @notice Read-only projection: genesis allocation + everything the halving
    /// schedule has made claimable by the current block (stakers' share while
    /// someone was staking, plus all four ecosystem buckets), whether or not it has
    /// been claimed yet. Free to read (no gas, no state change).
    /// This is NOT totalSupply() — totalSupply() only ever reflects tokens that
    /// have actually been minted.
    function emittedSupply() external view returns (uint256) {
        if (staking == address(0)) return GENESIS_ALLOCATION;
        return IStakingSupply(staking).emittedSupply();
    }
}
