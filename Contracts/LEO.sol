// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IStakingSupply {
    function emittedSupply() external view returns (uint256);
}

/// @notice HELEO (LEO) fixed-cap token.
/// The 21,000,000 LEO genesis allocation is minted at deploy, split equally across
/// the 9 contributor wallets. The other 21,000,000 LEO (EMISSION_ALLOCATION) can
/// only be minted by the Staking contract over the halving schedule. No public mint
/// exists.
contract LEO is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 42_000_000 ether;
    uint256 public constant GENESIS_ALLOCATION = 21_000_000 ether;
    uint256 public constant EMISSION_ALLOCATION = 21_000_000 ether;
    uint256 public constant CONTRIBUTOR_COUNT = 9;

    address public staking;
    uint256 public emissionMinted;

    error InvalidAddress();
    error DuplicateContributor();
    error StakingAlreadySet();
    error OnlyStaking();
    error CapExceeded();

    /// @param contributors The 9 contributor wallets. Each receives
    /// GENESIS_ALLOCATION / 9; the 3 wei of integer-division remainder go to
    /// contributors[0] so exactly GENESIS_ALLOCATION is minted.
    constructor(address[9] memory contributors) ERC20("HELEO", "LEO") Ownable(msg.sender) {
        uint256 share = GENESIS_ALLOCATION / CONTRIBUTOR_COUNT;
        for (uint256 i = 0; i < CONTRIBUTOR_COUNT; ++i) {
            if (contributors[i] == address(0)) revert InvalidAddress();
            for (uint256 j = 0; j < i; ++j) {
                if (contributors[j] == contributors[i]) revert DuplicateContributor();
            }
            _mint(contributors[i], share);
        }
        _mint(contributors[0], GENESIS_ALLOCATION - share * CONTRIBUTOR_COUNT);
    }

    /// @dev One-time, irreversible wiring — there is no way to change `staking`
    /// once set. After calling this, owner retains no further privileged function
    /// in this contract; call renounceOwnership() post-setup to remove the
    /// otherwise-unused admin key as an attack surface.
    function setStaking(address staking_) external onlyOwner {
        if (staking_ == address(0)) revert InvalidAddress();
        if (staking != address(0)) revert StakingAlreadySet();
        staking = staking_;
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
