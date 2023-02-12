# Staking Contract

contract for staking ERC-20 token and rewarding stakers.

Contract manager role can set staking token, reward token, minimum staking period and
staking reward rate.

All these parameters can only be changed by the manager role at any time.

The contract is also pausable. Only the pauser role can pause the contract.
