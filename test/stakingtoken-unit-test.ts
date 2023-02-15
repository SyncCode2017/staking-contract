import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { assert, expect } from "chai"
import { BigNumber, ContractTransaction } from "ethers"
import { network, deployments, ethers, getNamedAccounts } from "hardhat"
import { networkConfig, ONE } from "../helper-hardhat-config"
import { StakingToken as StakingTokenType, MockERC20 as MockERC20Type } from "../typechain-types"
import { mock } from "../typechain-types/contracts"
import { setupUser } from "../utils/helper-functions"
import { moveTime } from "../utils/move-time"
import { moveBlocks } from "../utils/move-blocks"

const setup = deployments.createFixture(async () => {
    await deployments.fixture("all")
    const { deployer, alice, bob } = await getNamedAccounts()

    const contracts = {
        stakingToken  : <StakingTokenType> await ethers.getContract("StakingToken"),
        mockToken  : <MockERC20Type> await ethers.getContract("MockERC20")
    }
    return {
        ...contracts,
        deployer : await setupUser(deployer, contracts),
        alice    : await setupUser(alice, contracts),
        bob      : await setupUser(bob, contracts),
    }
})

type TestAccount = {
    address: string,
    signer: SignerWithAddress
} & {
    stakingToken: StakingTokenType,
    mockToken  : MockERC20Type
}

describe("Stake Manager Unit Tests", function () {
    let deployer: TestAccount,
        alice: TestAccount,
        bob: TestAccount,
        accounts: SignerWithAddress[],
        stakers: TestAccount[],
        stakeAmounts: BigNumber[],
        stakingToken: StakingTokenType,
        mockToken: MockERC20Type,
        rateX1m: number,
        minStakingPeriod: number,
        fundsToContract: BigNumber

    beforeEach("Set up accounts and contract", async () => {
        ({ deployer, alice, bob, stakingToken, mockToken }  = await setup())
        accounts = await ethers.getSigners()
        stakers = [deployer, alice, bob]
        fundsToContract = ONE.mul(10**6)
        stakeAmounts = [ONE.mul(100), ONE.mul(100), ONE.mul(100)]
        rateX1m = networkConfig[network.name].rateX1m!  // 100% staking reward
        minStakingPeriod = networkConfig[network.name].minStakingPeriod!
        const trx: ContractTransaction = await deployer.mockToken.mint(stakingToken.address, fundsToContract)
        await trx.wait()
    })

    describe("constructor", function () {
        it("Check staking token is deployed", async () => {
            expect(stakingToken.address).to.be.not.empty
        })
        it("initiallizes the stakingToken correctly", async () => {
            const allowedStakingToken: string = await stakingToken.stakingToken()    
            assert.equal(allowedStakingToken, mockToken.address)
        })
        it("initiallizes the rewards token correctly", async () => {
            const tokenForReward: string = await stakingToken.rewardsToken()
            assert.equal(tokenForReward, mockToken.address)
        })
        it("initiallizes the rateX1m correctly", async () => {
            const rewardsRate = Number(await stakingToken.returnOnStakingX1m())
            assert.equal(rewardsRate, rateX1m)
        })
        it("initiallizes the minimum staking period correctly", async () => {
            const minHoldingPeriod = Number(await stakingToken.minStakingPeriodInSec())
            assert.equal( minHoldingPeriod, minStakingPeriod)
        })
    })
    describe("stake function", function () {
        it("allows staking when not paused", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
        })
        it("emits staked event", async () => {
            for (let i=0; i<stakers.length; i++) {
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                await expect(stakers[i].stakingToken.stake(stakeAmounts[i])).to.emit(stakingToken, "Staked")
            }
        })
        it("does not allow staking when tokens are not approved", async () => {
            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.stake(stakeAmounts[i])).to.be.revertedWith("ERC20: insufficient allowance") 
            }
        })
    })
    describe("unstake function", function () {
        it("allows unstaking when not paused", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            
            // after one month of staking
            await moveTime(2592010)
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx1: ContractTransaction = await stakers[i].stakingToken.unStake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal(finalBal - initialBal, Number(stakeAmounts[i]))
                assert.equal(Number((await stakingToken.stakeOf(stakers[i].address)).amount), 0)
            }
        })
        it("does not allow unstaking when paused", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            // after one month of staking
            await moveTime(2592010)
             // pause the contract
            const trx: ContractTransaction = await deployer.stakingToken.pause()
            await trx.wait()

            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.unStake(stakeAmounts[i])).to.be.revertedWith("Pausable: paused") 
            }
        })
        it("does not allow unstaking when minimum staking period has not passed", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            // after less than one month of staking
            await moveTime(1000)

            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.unStake(stakeAmounts[i])).to.be.revertedWith("StakingToken__MinimumStakingPeriodHasNotPassed") 
            }
        })
        it("rejects if the caller does not have staked token", async () => {
            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.unStake(stakeAmounts[i])).to.be.revertedWith("StakingToken__InsufficientBalance")
            }
        })
        it("emits unStaked event", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            // after one month of staking
            await moveTime(2592010)

            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.unStake(stakeAmounts[i])).to.emit(stakingToken, "Unstaked") 
            }
        })
    })
    describe("claimReward function", function () {
        it("allows claimReward when not paused", async () => {
             for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            
            // after one year of staking
            await moveTime(31536000)
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx1: ContractTransaction = await stakers[i].stakingToken.claimRewardFor(stakers[i].address)
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                const changeInBal = (finalBal - initialBal).toString()
                const changeInBalEth = Math.floor(Number(ethers.utils.formatEther(changeInBal)))
                assert.equal(changeInBalEth, Number(ethers.utils.formatEther(stakeAmounts[i].toString())))
            }
        })
        it("calculate rewards correctly", async () => {
            // staking
            for (let i=0; i<stakers.length; i++) {
               const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
               const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
               await trx.wait()
               const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
               await trx1.wait()
               const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
               assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
           }
           
           // after one year of staking
           await moveTime(31536000)
           // add more stakes
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }

            // after two years of staking
           await moveTime(31536000)

            for (let i=0; i<stakers.length; i++) {
               const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
               const trx1: ContractTransaction = await stakers[i].stakingToken.claimRewardFor(stakers[i].address)
               await trx1.wait()
               const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
               const changeInBal = (finalBal - initialBal).toString()
               const changeInBalEth = Math.floor(Number(ethers.utils.formatEther(changeInBal)))
               const currentStakerReward = Number(ethers.utils.formatEther(stakeAmounts[i].toString())) * 3
               assert.equal(changeInBalEth, currentStakerReward) 
           }
       })
       it("does not allow claimReward when paused", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            // after one year of staking
            await moveTime(31536000)
            // pause the contract
            const trx: ContractTransaction = await deployer.stakingToken.pause()
            await trx.wait()
            for (let i=0; i<stakers.length; i++) {
                await expect(stakers[i].stakingToken.claimRewardFor(stakers[i].address)).to.be.revertedWith("Pausable: paused") 
            }
        })
    })
    describe("setters function", function () {
        it("allows manager role (setRewardsRateX1m) to set new staking reward rate", async () => {
            const rewardsRate = Number(await stakingToken.returnOnStakingX1m())
            assert.equal(rewardsRate, rateX1m)
            // after one year
            await moveTime(31536000)
            const newRewardsRate = 2 * (10**6)
            const trx: ContractTransaction = await deployer.stakingToken.setRewardsRateX1m(newRewardsRate)
            await trx.wait()
            const newRate = Number(await stakingToken.returnOnStakingX1m())
            assert.equal(newRewardsRate, newRate)

        })
        it("blocks other users from setting new staking reward rate", async () => {
            const rewardsRate = Number(await stakingToken.returnOnStakingX1m())
            assert.equal(rewardsRate, rateX1m)
            // after one year
            await moveTime(31536000)
            const newRewardsRate = 2 * (10**6)
            await expect(alice.stakingToken.setRewardsRateX1m(newRewardsRate)).to.be.reverted
        })
        it("updates accumulatedRewardAmount correctly when returnOnStakingX1m is changed", async () => {
            for (let i=0; i<stakers.length; i++) {
                const initialBal = Number(await mockToken.balanceOf(stakers[i].address))
                const trx: ContractTransaction = await stakers[i].mockToken.approve(stakingToken.address, stakeAmounts[i])
                await trx.wait()
                const trx1: ContractTransaction = await stakers[i].stakingToken.stake(stakeAmounts[i])
                await trx1.wait()
                const finalBal = Number(await mockToken.balanceOf(stakers[i].address))
                assert.equal((initialBal - finalBal), Number(stakeAmounts[i]))
            }
            // after one year
            await moveTime(31536000)
            const newRewardsRate1 = 2 * (10**6)
            const trx1: ContractTransaction = await deployer.stakingToken.setRewardsRateX1m(newRewardsRate1)
            await trx1.wait()

            // after another year
            await moveTime(31536000)
            const newRewardsRate2 = 3 * (10**6)
            const trx2: ContractTransaction = await deployer.stakingToken.setRewardsRateX1m(newRewardsRate2)
            await trx2.wait()
            for (let i=0; i<stakers.length; i++) {
                const accumulatedRewardWei = (await stakingToken.accumulatedRewardAmount(stakers[i].address)).toString()
                const accumulatedRewardEth = Math.floor(Number(ethers.utils.formatEther(accumulatedRewardWei)))
                assert.equal(Number(ethers.utils.formatEther(stakeAmounts[i].toString())) * 3, accumulatedRewardEth)
            }
        })
        it("only pauser role can pause the contract", async () => {
            // after one year
            await moveTime(31536000)
            await expect(alice.stakingToken.pause()).to.be.reverted
        })
        it("only pauser role can unpause the contract", async () => {
            await moveTime(1000)
            const trx: ContractTransaction = await deployer.stakingToken.pause()
            await trx.wait()
            await expect(bob.stakingToken.claimReward()).to.be.revertedWith("Pausable: paused")
            // after one year
            await moveTime(31536000)
            await expect(alice.stakingToken.pause()).to.be.reverted
        })
    })
})
