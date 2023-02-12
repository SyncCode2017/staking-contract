//SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

error StakingToken__TransactionFailed();
error StakingToken__TokenNotAllowed();
error StakingToken__ZeroAddress();
error StakingToken__InsufficientBalance();
error StakingToken__MinimumStakingPeriodHasNotPassed();
error StakingToken__MustBeGreaterthanZero();
error StakingToken__NoUnclaimedReward();

contract StakingToken is ReentrancyGuard, Pausable, AccessControl {
    // defensive as not required after pragma ^0.8
    using SafeMath for uint256;
    using ERC165Checker for address;
    using SafeERC20 for IERC20;

    // access control roles
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    uint256 public constant oneYearInsec = 31536000; // 365 * 24 * 60 * 60

    uint256 public minStakingPeriodInSec; // e.g 1 month = 30 * 60 * 60
    IERC20 public rewardsToken;

    // returnOnStakingX1m is the yield on the staked token X 1,000,000 e.g 100 rewardsToken
    // for every 1 stakingToken staked for 1 year, returnOnStakingX1m = 100 * (10**6) = 10**8
    uint256 public returnOnStakingX1m;
    IERC20 public stakingToken;
    address[] private stakersAddresses;

    struct stakeStruct {
        uint256 amount; // amount being staked
        uint256 startTime; // timestamp when tokens were staked
        uint256 lastClaimTime; // timestamp when last claim was made
    }

    mapping(address => stakeStruct) public stakeOf;
    mapping(address => uint256) public accumulatedRewardAmount;

    // Events
    event Claimed(address indexed beneficiary, uint256 amount);
    event Staked(address indexed staker, uint256 amount);
    event Unstaked(address indexed beneficiary, uint256 amount);

    constructor(
        address _allowedStakeToken,
        address _rewardsToken,
        uint256 _rateX1m,
        uint256 _minStakingPeriodInSec
    ) {
        // initialise the contract
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        setAllowedToken(_allowedStakeToken);
        setRewardToken(_rewardsToken);
        setRewardsRateX1m(_rateX1m);
        setMinStakingPeriod(_minStakingPeriodInSec);
    }

    //////////////////////////////////////////////////
    //////////////// Modifier //////////////////////
    /////////////////////////////////////////////////

    modifier noZeroAddress(address newAddress) {
        if (newAddress == address(0)) revert StakingToken__ZeroAddress();
        _;
    }

    //////////////////////////////////////////////////
    //////////////// Setters Functions //////////////
    /////////////////////////////////////////////////

    function setAllowedToken(
        address _allowedStakeToken
    ) public onlyRole(MANAGER_ROLE) noZeroAddress(_allowedStakeToken) {
        stakingToken = IERC20(_allowedStakeToken);
    }

    function setRewardToken(
        address _rewardsToken
    ) public onlyRole(MANAGER_ROLE) noZeroAddress(_rewardsToken) {
        rewardsToken = IERC20(_rewardsToken);
    }

    /// @notice This function updates the accumulated rewards of all stakers
    /// before changing the staking reward rate
    /// @param _rateX1m is the yield on the staked token X 1,000,000 e.g 100 rewardsToken
    /// for every 1 stakingToken staked for 1 year, _rateX1m = 100 * (10**6) = 10**8
    function setRewardsRateX1m(uint256 _rateX1m) public onlyRole(MANAGER_ROLE) {
        if (_rateX1m <= 0) revert StakingToken__MustBeGreaterthanZero();
        updateStakersAccumulatedRewards();
        returnOnStakingX1m = _rateX1m;
    }

    function setMinStakingPeriod(
        uint256 _periodInsec
    ) public onlyRole(MANAGER_ROLE) {
        if (_periodInsec <= 0) revert StakingToken__MustBeGreaterthanZero();
        minStakingPeriodInSec = _periodInsec;
    }

    /// @dev Pauses the contract
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @dev Unpauses the contract
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    //////////////////////////////////////////////////
    //////////////// Main Functions /////////////////
    /////////////////////////////////////////////////

    /// @notice Stake the allowed token
    /// @param _amount The amount of stakingToken to stake
    function stake(uint256 _amount) external nonReentrant {
        // check the token balance of the caller
        if (
            stakingToken.balanceOf(msg.sender) < _amount ||
            stakingToken.balanceOf(msg.sender) == 0
        ) {
            revert StakingToken__InsufficientBalance();
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

        // check if the caller is an existing staker
        if (stakeOf[msg.sender].startTime <= 0) {
            // create stake struct for the new staker
            stakeOf[msg.sender] = stakeStruct(
                _amount,
                block.timestamp,
                block.timestamp
            );
            stakersAddresses.push(msg.sender);
        } else {
            // update stake struct for the existing staker
            accumulatedRewardAmount[msg.sender] += calculateReward(msg.sender);
            stakeOf[msg.sender].lastClaimTime = block.timestamp;
            stakeOf[msg.sender].amount += _amount;
        }
        // emit event
        emit Staked(msg.sender, _amount);
    }

    /// @notice Allow stakers to unstake their token
    /// @param _amount The amount of stakingToken to withdraw
    function unStake(uint256 _amount) external whenNotPaused {
        // check if caller has staked tokens
        if (stakeOf[msg.sender].amount < _amount)
            revert StakingToken__InsufficientBalance();
        // check if the minimum staking period has passed
        if (
            block.timestamp <=
            (stakeOf[msg.sender].startTime.add(minStakingPeriodInSec))
        ) {
            revert StakingToken__MinimumStakingPeriodHasNotPassed();
        }

        // send staked tokens and reward tokens
        uint256 stakedAmount = stakeOf[msg.sender].amount;
        accumulatedRewardAmount[msg.sender] += calculateReward(msg.sender);
        stakeOf[msg.sender].amount -= _amount;
        stakeOf[msg.sender].lastClaimTime = block.timestamp;
        sendValue(payable(msg.sender), stakingToken, stakedAmount);
        emit Unstaked(msg.sender, _amount);
    }

    /// @notice Claim reward on behalf of the staker
    /// @param _beneficiary The recipient address
    function claimRewardFor(
        address _beneficiary
    ) public whenNotPaused nonReentrant {
        // check if _staker has unclaimed reward tokens
        uint256 _unclaimedAmount = accumulatedRewardAmount[msg.sender].add(
            calculateReward(_beneficiary)
        );
        if (_unclaimedAmount <= 0) revert StakingToken__NoUnclaimedReward();

        // transfer the unclaimed reward tokens to the caller
        accumulatedRewardAmount[msg.sender] = 0;
        stakeOf[_beneficiary].lastClaimTime = block.timestamp;
        sendValue(payable(_beneficiary), rewardsToken, _unclaimedAmount);
    }

    /// @notice Claim reward tokens
    function claimReward() external whenNotPaused {
        claimRewardFor(msg.sender);
    }

    /// @notice Calculate reward from the last time the staker claimed reward tokens
    /// @param _staker The staker address
    /// @return The amount of reward tokens claimable
    function calculateReward(address _staker) internal view returns (uint256) {
        uint256 _rewardAmount = (
            block.timestamp.sub(stakeOf[_staker].lastClaimTime)
        ).mul(returnOnStakingX1m).mul(stakeOf[_staker].amount).div(10 ** 6).div(
                oneYearInsec
            );
        return _rewardAmount;
    }

    /// @notice Transfer token from the contract to the recipient
    /// @param _recipient The recipient address
    /// @param _token The token to transfer
    /// @param _amount The amount of tokens to transfer
    function sendValue(
        address payable _recipient,
        IERC20 _token,
        uint256 _amount
    ) internal {
        // check the contract balance
        if (_token.balanceOf(address(this)) < _amount) {
            revert StakingToken__InsufficientBalance();
        }
        // send tokens to the user
        _token.safeTransfer(_recipient, _amount);
    }

    /// @notice This function gets called only when the manager role decides
    /// to set new staking reward rate.
    function updateStakersAccumulatedRewards() internal {
        address[] memory _stakers = stakersAddresses;
        for (uint256 i = 0; i < _stakers.length; ++i) {
            accumulatedRewardAmount[_stakers[i]] += calculateReward(
                _stakers[i]
            );
            stakeOf[_stakers[i]].lastClaimTime = block.timestamp;
        }
    }

    ///@dev Receive ether in the contract
    receive() external payable {}

    /// @notice Only the manager role can withdraw ether sent to the contract
    function withdrawEther() external onlyRole(MANAGER_ROLE) nonReentrant {
        uint256 _amount = address(this).balance;
        if (_amount <= 0) {
            revert StakingToken__InsufficientBalance();
        }
        // send tokens to the user
        (bool success, ) = msg.sender.call{value: _amount}("");
        if (!success) {
            revert StakingToken__TransactionFailed();
        }
    }

    //////////////////////////////////////////////////
    //////////////// Getter /////////////////////////
    /////////////////////////////////////////////////
    function getStakersAddresses()
        external
        view
        onlyRole(MANAGER_ROLE)
        returns (address[] memory)
    {
        address[] memory _stakers = stakersAddresses;
        return _stakers;
    }
}
