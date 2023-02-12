import { ethers } from "hardhat"
import { BigNumber } from "ethers"

export const networkConfig: networkConfigInfo = {
    hardhat: {
        rateX1m: 1000000, // 1 reward token for every staked token for one year 
        minStakingPeriod: 2592000,
    },
    localhost: {
        rateX1m: 1000000, // 1 reward token for every staked token for one year 
        minStakingPeriod: 2592000,
    },
    polygonMumbai: {
        rateX1m: 1000000, // 1 reward token for every staked token for one year 
        minStakingPeriod: 2592000,
        blockConfirmations: 6,
    },
    goerli: {
        rateX1m: 1000000, // 1 reward token for every staked token for one year 
        minStakingPeriod: 2592000,
        blockConfirmations: 6,
    },
    mainnet: {
        rateX1m: 1000000, // 1 reward token for every staked token for one year 
        minStakingPeriod: 2592000,
        blockConfirmations: 6,
    },
}

export const ONE: BigNumber = ethers.utils.parseEther("1") // Token has 18 decimals
export const VERIFICATION_BLOCK_CONFIRMATIONS = 6

export interface networkConfigItem {
    rateX1m: number,
    minStakingPeriod: number,
    blockConfirmations?: number,
}

export interface networkConfigInfo {
    [key: string]: networkConfigItem
}

export const developmentChains = ["hardhat", "localhost"]
