import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter } from '@uniswap/smart-order-router';
import { ethers } from "ethers";
import { getProvider } from '../../settings/provider';
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import { Erc20, getErc20 } from "../arbitrageobject/erc20";
import { LpPool } from "../arbitrageobject/lpPool";
import { calc_profit, getSpotPrice, optimizeV3Bulk, smart_router, swapAmount } from "../helpers";
import { callFlashswap } from "./callflashswap";

const BigNumber = ethers.BigNumber


async function main(){
    let startTime,endTime,totalTime
    startTime = performance.now()

    

    const usdc_token = address.token.usdc
    const weth_token = address.token.weth
    const inputAmount = ethers.utils.parseUnits('100000',6)
    // const quote = await smart_router({tokenInAddress:weth_token,tokenOutAddress:usdc_token,amount:inputAmount,isInput:false})
    // console.log(quote)
    const poolAddress1 = '0xe0CfA17aa9B8f930Fd936633c0252d5cB745C2C3'
    const poolAddress2 = '0xf660809B6D2D34cc43f620a9B22A40895365A5F8'
    const lp_pool1 = new LpPool({address:poolAddress1})
    await lp_pool1.init()
    const lp_pool2 = new LpPool({address:poolAddress2})
    await lp_pool2.init()

    let borrowToken
    if (lp_pool1.token0?.address===address.token.weth){
        borrowToken=lp_pool1.token1!.address
    }else{
        borrowToken=lp_pool1.token0!.address
    }

    // const borrowAmount = ethers.BigNumber.from('3760141298539725586432')
    // const amount = await swapAmount(lp_pool1,borrowAmount,borrowToken,true)
    // const amount_check = await lp_pool1.swapAmount(borrowAmount,borrowToken,true)
    // console.log(amount)
    // console.log(amount_check)

    const optimize_result = await optimizeV3Bulk([[lp_pool1,lp_pool2]])
    await callFlashswap(optimize_result)

    
    // const calcProfit = await calc_profit(borrowAmount,borrowToken,lp_pool2,lp_pool1)
    // console.log(calcProfit)

    // const swapOutAmount = await swapAmount(lp_pool2,borrowAmount,borrowToken,false)
    // console.log(swapOutAmount)

    // const check_swapAmount = await lp_pool1.swapAmount(borrowAmount,borrowToken,true)
    // console.log(check_swapAmount)

    endTime = performance.now()
    totalTime = Math.round(((endTime - startTime) / 1000)*1000)/1000
    console.log(`Total Time: ${totalTime}s`)
}





main()

