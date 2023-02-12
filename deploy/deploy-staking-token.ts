import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction, DeployResult } from "hardhat-deploy/types"
import {verify} from "../utils/helper-functions"
import { developmentChains, networkConfig, ONE } from "../helper-hardhat-config"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"

const deployStakingToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

    const { getNamedAccounts, deployments, network } = hre
    const accounts: SignerWithAddress[] = await hre.ethers.getSigners()
    const { deploy, log } = deployments

    const { deployer } = await getNamedAccounts()
    const alice = accounts[1]
    const bob = accounts[2]


    let waitBlockConfirmations: number
    if (developmentChains.includes(network.name)) {
        waitBlockConfirmations = 1
    } else {
        waitBlockConfirmations = networkConfig[network.name].blockConfirmations!
    }
    log("----------------------------------------------------")

    const argsMock: [string[], BigNumber[]] = [[deployer, alice.address, bob.address], [ONE.mul(1000), ONE.mul(1000), ONE.mul(1000)]]
    const mockToken:DeployResult = await deploy("MockERC20", {
        from: deployer,
        args: argsMock,
        log: true,
        waitConfirmations: waitBlockConfirmations,
    })

    log("----------------------Mock token deployed--------------")

    const args: [string, string, number, number] = [mockToken.address, mockToken.address, networkConfig[network.name].rateX1m!, networkConfig[network.name].minStakingPeriod!]
    const stakingToken:DeployResult = await deploy("StakingToken", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: waitBlockConfirmations,
    })

    log("-------------StakingToken deployed-------------------")

    // Verify the contracts
    if (
        !developmentChains.includes(network.name) &&
        process.env.ETHERSCAN_API_KEY
    ) {
        log("Verifying...")
        await verify(stakingToken.address, args)
    }

}

export default deployStakingToken
deployStakingToken.tags = ["all","staking"]
