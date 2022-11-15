import { Token } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { ethers } from "ethers";
import { isMappedTypeNode } from "typescript";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import { getLpPoolV3, LpPool } from "../arbitrageobject/lpPool";
import { calcProfitExternal, findBestProfit, getSpotPrice, optimizeV3, retry, swapAmount } from "../helpers";
import { callFlashswap } from "./callflashswap";

async function uniV3Events() {
  const providerws = await getProvider("node", "ws");
  const iface = new ethers.utils.Interface([
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  ]);

  const topics = [
    ethers.utils.id(
      "Swap(address,address,int256,int256,uint160,uint128,int24)"
    ),
    
  ];
  // Create event filter
  const txfilter = {
    topics,
  };
  console.log("Start monitoring swap events...");

  providerws.on(txfilter, async (log: any, event: any) => {
    let startTime, endTime, totalTime;
    startTime = performance.now();
    let decodelog
    try{
      decodelog = iface.parseLog(log);
    }catch(err){
      console.log(err)
      return
    }
    
    const pairAddress = log.address;
    const lp_pool = new LpPool({ address: pairAddress });
    await lp_pool.init();

    const amount0 = ethers.utils.formatUnits(
      decodelog.args.amount0,
      lp_pool.token0!.decimals
    );
    const amount1 = ethers.utils.formatUnits(
      decodelog.args.amount1,
      lp_pool.token1!.decimals
    );
    const token0sym = lp_pool.token0!.symbol;
    const token1sym = lp_pool.token1!.symbol;
    
    let borrowToken:Token,baseToken:Token
    if (lp_pool.token0?.address===address.token.weth){
      baseToken = lp_pool.token0!
      borrowToken = lp_pool.token1!
    }else{
      baseToken = lp_pool.token1!
      borrowToken = lp_pool.token0!
    }

    // Get relevant pools 
    const bestProfit = await findBestProfit(lp_pool.token0?.address,lp_pool.token1?.address)
    // console.log(bestProfit)

    endTime = performance.now();
    totalTime = Math.round(((endTime - startTime) / 1000) * 1000) / 1000;
    const grossprofit_threshold = 0.005

    if(bestProfit.status===0){
      const profit = ethers.utils.formatUnits((bestProfit.profitAmount),18)

      if(Number(profit)>grossprofit_threshold){
        const borrow = ethers.utils.formatUnits((bestProfit.borrowAmount),borrowToken!.decimals)
        const swapOutAmount = ethers.utils.formatUnits((bestProfit.swapOutAmount),baseToken!.decimals)
        const flashrepayAmount = ethers.utils.formatUnits((bestProfit.repayAmount),baseToken!.decimals)
        const timestamp = (new Date(Date.now())).toLocaleTimeString()
        console.log(`---------------------------------------------------`)
        console.log(
            `[${timestamp}] Swap Event on ${token0sym}-${token1sym} | ${token0sym}: ${amount0} | ${token1sym}: ${amount1} | ${log.transactionHash} | Block: ${log.blockNumber} | Time: ${totalTime}s`
          );
        console.log(`Pool1: ${bestProfit.contract_input.pool1} | Pool2: ${bestProfit.contract_input.pool2}`)
        console.log(`Best Profit: ${profit} | Borrow: ${borrow} | swapout: ${swapOutAmount} | repay: ${flashrepayAmount} | Pool1Type: ${bestProfit.contract_input.pool1Type} | Pool1Type: ${bestProfit.contract_input.pool2Type}`)
        console.log(`Calling flashswap`)
        await callFlashswap(bestProfit)
      }    
    }
  });
  
}

uniV3Events()

