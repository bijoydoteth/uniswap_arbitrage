import { Token } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { ethers } from "ethers";
import { type } from "os";
import { QueryResult } from "pg";
import { isMappedTypeNode } from "typescript";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import { getLpPoolV3, LpPool } from "../arbitrageobject/lpPool";
import { calcProfitExternal, convertDBQuerytoEdges, convertLogsToEdges, convertLogtoDBQuery, filterUniqueLastLog, findBestProfit, findBestProfitCycles, getSpotPrice, getSpotRatioFast, optimizeV3, updateEdges } from "../helpers";
import { callFlashswap } from "./callflashswap";

async function uniV3BlockEvents() {
  const providerws = await getProvider("node", "ws");
  
  const iface = new ethers.utils.Interface([
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
    "event Sync(uint112 reserve0, uint112 reserve1)",
  ]);

  const topics = [[
    ethers.utils.id(
      "Swap(address,address,int256,int256,uint160,uint128,int24)"
    ),
    ethers.utils.id(
      "Sync(uint112,uint112)"
    )
  ]];
  // 
  
  console.log("Start monitoring V2 and V3 events in block and update graphs...");

  providerws.on("block", async (blockNumber: any) => {
      let startTime: number,endTime: number,totalTime: number
      startTime = performance.now()

      const logs = await providerws.getLogs({
        topics,
        fromBlock:blockNumber,
        toBlock:blockNumber
      })
      if (logs.length>0){
        const edgeResult = await convertLogsToEdges(logs)
        const profit = await findBestProfitCycles(edgeResult.uniqueEdgesPath)
        
        endTime = performance.now()
        totalTime = Math.round(((endTime - startTime) / 1000)*1000)/1000
        console.log(`[${(new Date(Date.now())).toLocaleTimeString()}] ${edgeResult.msg.length} edges updated on block ${blockNumber} | Time: ${totalTime}s | Path: ${profit.stat.bestPath?profit.stat.bestPath.join(' -> '):'None'} | Best Profit ${profit.stat.formattedProfit.unit}: ${profit.stat.formattedProfit.amount} `)
        console.log(profit.bestProfit?.path)
        console.log(profit.stat)


      }else{
        console.log(`[${(new Date(Date.now())).toLocaleTimeString()}] no edges updated on block ${blockNumber} `)
      }
      
  });
  
}
  
uniV3BlockEvents()