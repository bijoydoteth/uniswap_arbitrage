import dotenv from "dotenv";
import { ethers } from "ethers";
import { getProvider, getSigner } from "../../settings/provider";
dotenv.config({ path: "../../settings/.env" });

// Uniswaps SDK
import { CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import { abi as TickLensABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json";
import { Pool, Route, Trade } from "@uniswap/v3-sdk";

// Other imports
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import { getErc20 } from "../arbitrageobject/erc20";
import { getLpPoolV3, LpPool } from "../arbitrageobject/lpPool";
import { computeSwapStep, getAmountDelta, getSqrtRatioX96FromTick, getTickFromSqrtRatioX96 } from "../helpers";
const provider = getProvider();

async function main() {
  const poolAddress = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
  const poolAddress1 = "0x11b815efB8f581194ae79006d24E0d814B7697F6";
  const poolAddress2 = "0x161fB57FD46002113deb471e8aFCF389FafAe748"; // V2 Pool
  const poolAddressMatic = '0x99C7550be72F05ec31c446cD536F8a29C89fdB77'

  // Swap 100 USDC (token0)
  const input_amount_usdc = 100000000;
  const input_amount_weth = 1 * 10 ** 18;
  const input_token_usdc = address.token.usdc;
  const input_token_weth = address.token.weth;

  let startTime, endTime, totalTime
  const lp_pool = new LpPool({address:poolAddressMatic})
  await lp_pool.init()
  startTime = performance.now()
  const result = await lp_pool.calc_swap(input_amount_weth, input_token_weth,false);
  endTime = performance.now()
  totalTime = Math.round(((endTime - startTime) / 1000)*1000)/1000
  console.log(`Total Time: ${totalTime}s`)
  console.log(result)

  startTime = performance.now()
  const check_result = await lp_pool.swapAmount(input_amount_weth,input_token_weth,false)
  endTime = performance.now()
  totalTime = Math.round(((endTime - startTime) / 1000)*1000)/1000
  console.log(`Total Time: ${totalTime}s`)
  console.log(check_result)

  

  

  
}

main();
