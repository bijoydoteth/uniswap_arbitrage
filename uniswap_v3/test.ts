import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter } from "@uniswap/smart-order-router";
import { abi as TickLensABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json";
import { LiquidityMath } from "@uniswap/v3-sdk";
import { ethers } from "ethers";
import { read } from "fs";
import fs from "fs/promises";
import { start } from "repl";
import { IndentStyle } from "typescript";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import {
    addTokentoBlackList, checkErc20inDB, Erc20,
    getErc20,
    getErc20Balance,
    getPoolErc20AndBalance
} from "../arbitrageobject/erc20";
import { addNewPoolsV3, addNewTokensFromPools, addV2V3PoolsAndCheckCriteria, bulkCheckCriteria, checkPoolBlackList, LpPool, LpPools, v3_pool_abi } from "../arbitrageobject/lpPool";
import {
    calc_profit, constructGraphObjectFromDB, filterUniqueLastLog, findBestProfitCycles, getSpotPrice,
    getSpotRatioFast, getSpotRatioFastBulk, loadGraphFromDB, loadGraphObjectToDB, optimizeV3,
    optimizeV3Bulk,
    queryGraphEdge,
    smart_router,
    test_run_python,
    unpackPoolParam, updateAllEdgesInDB, updateAllEdgesInGraph,
    updateEdges, updateGraphObjectFromDB, updateSpotPrice
} from "../helpers";
import { callFlashswap } from "./callflashswap";

const BigNumber = ethers.BigNumber;
const provider = getProvider();

async function main() {
    let startTime, endTime, totalTime;
    startTime = performance.now();

    const ticklensAddress = address.dex.uniswap.v3.ticklens;
    const multicallAddress = address.other.multicall;

    const weth_token = address.token.weth;
    const usdc_token = address.token.usdc
    const inputAmountWETH = ethers.utils.parseUnits("1", 18);
    const inputAmountUSDC = ethers.utils.parseUnits("1000", 6);

    const weth_usdc_v3 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
    const weth_usdc_pool = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
    const sample_pools = [
        '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
        "0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f",
        "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36",
        "0xD920a4bDa8eCf4Ac06eA2897f9a5A38A55E9aC6e",
        "0xe977868FFAe44FDa3478eeF990c89CA353A13264",
        "0xa4785e6f90d1aEf752115c686501a97056100091",
        "0xF0bAB457c71E4e294981D53C865560A92b23FCE7",
        "0x2DDe9dB1189D415C11b69d9a035730B84A727dF1",
        "0xe506a80A2D730bB73dDd62Bec85f3Ae3acc1402F",
        // "0xeC565af969aC889387a73844C2ab07ad17e2793A",
        ]
    const swapPoolPath = [
        '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        '0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f',
        '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36',
        ]
    
    const path = {
        tokens: [
          '0xf3b9569F82B18aEf890De263B84189bd33EBe452',
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          '0xf3b9569F82B18aEf890De263B84189bd33EBe452'
        ],
        pools: [
          '0xc0Fbed3CbBF272E0649dDFefDEC99F4ebA7ECa22',
          '0xc0Fbed3CbBF272E0649dDFefDEC99F4ebA7ECa22'
        ]
      }
    

    // const lp_pools = new LpPools({pools: path.pools});
    // await lp_pools.init();
    // const profit = await lp_pools.optimizeMultiHop(path.pools,path.tokens[1])
    // console.log(profit)

    // const lp_pool = new LpPool({address:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'})
    // await lp_pool.init()
    // console.log(await lp_pool.checkLiqCriteria())

    // await addTokentoBlackList('0xd233D1f6FD11640081aBB8db125f722b5dc729dc')
    // await updateGraphObjectFromDB()

    
    endTime = performance.now();
    totalTime = Math.round(((endTime - startTime) / 1000) * 1000) / 1000;
    console.log(`Total Time: ${totalTime}s`);
}



main();
