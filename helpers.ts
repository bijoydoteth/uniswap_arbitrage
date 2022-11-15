import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter } from "@uniswap/smart-order-router";
import { ethers } from "ethers";
import { getProvider } from "../settings/provider";
import { query_db } from "../settings/setupdb";
import { address } from "./address";
import { Erc20, getErc20 } from "./arbitrageobject/erc20";
import { LpPool } from "./arbitrageobject/lpPool";

const provider = getProvider("node", "rpc");

// Function to call a python file
// param is a list, first element is path, second is function name, third element and after is the function arguments
export function call_python(
  callback: {
    (data: any): Promise<void>;
    (arg0: { data: string; status: number }): void;
  },
  param: any,
  mode: string = "default"
) {
  const spawn = require("child_process").spawn;

  const pythonProcess = spawn("python", param, { silent: true });
  pythonProcess.stdout.on("data", function (data: string) {
    if (mode === "custom") {
      callback({ data: data.toString(), status: 0 });
    } else {
      let datastr = data.toString().replace(/(\r\n|\n|\r)/gm, "");
      callback({ data: datastr, status: 0 });
    }
  });
  let errorlog: string;
  pythonProcess.stderr.on("data", (err: any) => {
    if (mode === "custom") {
      errorlog = err.toString();
    } else {
      errorlog = err.toString().replace(/(\r\n|\n|\r)/gm, "");
    }
  });

  // in close event we are sure that stream from child process is closed
  pythonProcess.on("close", (code: number) => {
    if (code === 1) {
      callback({ data: errorlog, status: code });
      // console.log(`optimize profit process with code ${code}`);
    }
  });
}

// Retry functions for max number of entries
export function retry(maxRetries: number, fn: () => Promise<any>):any {
  return fn().catch(function(err: any) { 
    if (maxRetries <= 0) {
      throw err;
    }
    return retry(maxRetries - 1, fn); 
  });
}

export async function getSqrtRatioX96FromTick(tick: number) {
  const param = [
    "../../univ3py/univ3py_main/router.py",
    "getSqrtRatioAtTick",
    tick,
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param);
  });

  if (result.status === 0 && !isNaN(result.data)) {
    const ratio = ethers.BigNumber.from(result.data);
    return ratio;
  } else {
    console.log(result);
    return;
  }
}

export async function getTickFromSqrtRatioX96(SqrtXRatioX96: ethers.BigNumber) {
  const SqrtX96Input = SqrtXRatioX96.toString();

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "getTickAtSqrtRatio",
    SqrtX96Input,
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param);
  });

  if (result.status === 0 && !isNaN(result.data)) {
    return Number(result.data);
  } else {
    console.log(result);
    return Number(0);
  }
}

export async function getAmountDelta(
  sqrtRatioBeforeX96: ethers.BigNumber,
  sqrtRatioAfterX96: ethers.BigNumber,
  liquidity: ethers.BigNumber,
  isToken0: boolean,
  roundUp: boolean = false
) {
  let param: any[];
  if (isToken0) {
    param = [
      "../../univ3py/univ3py_main/router.py",
      "getAmount0Delta",
      sqrtRatioAfterX96.toString(),
      sqrtRatioBeforeX96.toString(),
      liquidity.toString(),
      roundUp,
    ];
  } else {
    param = [
      "../../univ3py/univ3py_main/router.py",
      "getAmount1Delta",
      sqrtRatioAfterX96.toString(),
      sqrtRatioBeforeX96.toString(),
      liquidity.toString(),
      roundUp,
    ];
  }

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param);
  });

  if (result.status === 0) {
    return result.data;
  } else {
    console.log(result);
    return;
  }
}

export async function computeSwapStep(
  liquidity: ethers.BigNumber,
  SqrtXRatioX96: ethers.BigNumber,
  sqrtRatioTargetX96: ethers.BigNumber,
  amountRemaining: ethers.BigNumber,
  isInput: boolean,
  feePips: number
) {
  const SqrtX96Input = SqrtXRatioX96.toString();
  const SqrtX96Output = sqrtRatioTargetX96.toString();
  const _liquidity = liquidity.toString();
  let amount;
  if (isInput) {
    amount = amountRemaining.toString();
  } else {
    amount = "-" + amountRemaining.toString();
  }

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "computeSwapStep",
    SqrtX96Input,
    SqrtX96Output,
    _liquidity,
    amount,
    feePips,
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param);
  });

  if (result.status === 0) {
    let datastr = result.data;
    datastr = datastr.replace(/[{()}]/g, "");
    datastr = datastr.replace(/\s/g, "");
    datastr = datastr.split(",");

    return {
      sqrtRatioNextX96: datastr[0],
      amountIn: datastr[1],
      amountOut: datastr[2],
      feeAmount: datastr[3],
    };
  } else {
    console.log(result);
    return;
  }
}

export async function smart_router(param: {
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: ethers.BigNumber;
  isInput: boolean;
}) {
  type swapAmount = {
    amount: string;
    amountInt: string;
    symbol?: string;
    tokenAddress?: string;
  };
  let input: swapAmount, output: swapAmount, gasAdjusted: swapAmount;
  const router_provider = getProvider();
  const router = new AlphaRouter({ chainId: 1, provider: router_provider });

  const tokenIn = await getErc20(param.tokenInAddress);
  const tokenOut = await getErc20(param.tokenOutAddress);

  const amount = CurrencyAmount.fromRawAmount(
    param.isInput === true ? tokenIn : tokenOut,
    param.amount
  );
  const quotecurrency = param.isInput === true ? tokenOut : tokenIn;
  const tradetype =
    param.isInput === true ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT;
  console.log(amount);

  const route = await router.route(amount, quotecurrency, tradetype, {
    recipient: address.bot.v1,
    slippageTolerance: new Percent(5, 100),
    deadline: Math.floor(Date.now() / 1000 + 1800),
  });

  if (route) {
    console.log(`Quote Exact In: ${route.quote.toFixed(5)}`);
    console.log(`Gas Adjusted Quote In: ${route.quoteGasAdjusted.toFixed(5)}`);
    console.log(`Gas Used USD: ${route.estimatedGasUsedUSD.toFixed(6)}`);
    console.log(`Token In: ${tokenIn.symbol} | Token Out: ${tokenOut.symbol}`);

    if (param.isInput) {
      input = {
        amount: ethers.utils.formatUnits(param.amount, tokenIn.decimals),
        amountInt: param.amount.toString(),
        symbol: tokenIn.symbol,
        tokenAddress: tokenIn.address,
      };
      output = {
        amount: route.quote.toFixed(5),
        amountInt: ethers.utils
          .parseUnits(route.quote.toFixed(5), tokenOut.decimals)
          .toString(),
        symbol: tokenOut.symbol,
        tokenAddress: tokenOut.address,
      };

      gasAdjusted = {
        amount: route.quoteGasAdjusted.toFixed(5),
        amountInt: ethers.utils
          .parseUnits(route.quoteGasAdjusted.toFixed(5), tokenOut.decimals)
          .toString(),
        symbol: tokenOut.symbol,
        tokenAddress: tokenOut.address,
      };
    } else {
      input = {
        amount: route.quote.toFixed(5),
        amountInt: ethers.utils.parseUnits(
          route.quote.toFixed(5),
          tokenIn.decimals
        ),
        symbol: tokenIn.symbol,
        tokenAddress: tokenIn.address,
      };
      output = {
        amount: ethers.utils.formatUnits(param.amount, tokenOut.decimals),
        amountInt: param.amount.toString(),
        symbol: tokenOut.symbol,
        tokenAddress: tokenOut.address,
      };

      gasAdjusted = {
        amount: route.quoteGasAdjusted.toFixed(5),
        amountInt: ethers.utils
          .parseUnits(route.quoteGasAdjusted.toFixed(5), tokenIn.decimals)
          .toString(),
        symbol: tokenIn.symbol,
        tokenAddress: tokenIn.address,
      };
    }

    // Other important parameters
    const tx_param = {
      data: route.methodParameters?.calldata,
      value: route.methodParameters?.value,
      gas: route.estimatedGasUsed,
    };

    return { input, output, gasAdjusted, tx_param };
  }
}

export async function swapAmount(
  pool: string | LpPool,
  amount: ethers.BigNumber,
  tokenAddress: string,
  isInput: boolean
) {
  const { lp_pool, poolparam } = await unpackPoolParam(pool);

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "swapAmount",
    amount.toString(),
    tokenAddress,
    isInput,
    JSON.stringify(poolparam),
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param, "custom");
  });
  if (result.status == 0) {
    let datastr = result.data;
    datastr = datastr.replace(/\s/g, "");
    datastr = datastr.replace(/[\[\]']+/g, "");
    datastr = datastr.split(",");
    return datastr[0];
  } else {
    return result;
  }
}

export async function optimizeV3(
  pool1: LpPool | string,
  pool2: LpPool | string,
  baseAddress: string = address.token.weth
) {
  const { lp_pool: lp_pool1, poolparam: poolparam1 } = await unpackPoolParam(
    pool1
  );
  const { lp_pool: lp_pool2, poolparam: poolparam2 } = await unpackPoolParam(
    pool2
  );

  let borrowAddress: string;
  if (poolparam1!.token0Address === baseAddress) {
    borrowAddress = poolparam1!.token1Address!;
  } else {
    borrowAddress = poolparam1!.token0Address!;
  }

  if (poolparam1!.status === 1 || poolparam2!.status === 1) {
    console.log(`poolparam error`);
    return { status: 1 };
  }

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "optimizePool",
    borrowAddress,
    JSON.stringify(poolparam1),
    JSON.stringify(poolparam2),
  ];
  // Print out params
  // console.log(borrowAddress)
  // console.log('------')
  // console.log(JSON.stringify(poolparam1))
  // console.log('------')
  // console.log(JSON.stringify(poolparam2))

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param, "custom");
  });
  if (result.status == 0) {
    let datastr = result.data;
    datastr = JSON.parse(datastr);
    const contract_input = {
      tokenBorrow: datastr.tokenBorrow,
      tokenBase: datastr.tokenBase,
      pool1: datastr.pool1,
      pool2: datastr.pool2,
      pool1Type: datastr.pool1Type,
      pool2Type: datastr.pool2Type,
      pool1sqrtPriceLimitX96: datastr.p1sqrtPriceX96,
      pool2sqrtPriceLimitX96: datastr.p2sqrtPriceX96,
      borrowAmount: datastr.optimal_borrow,
      repayAmount: datastr.repayAmount,
      swapOutAmount: datastr.swapOutAmount,
    };

    const formatted_output = {
      borrowAmount: datastr.optimal_borrow,
      profitAmount: datastr.profit,
      repayAmount: datastr.repayAmount,
      swapOutAmount: datastr.swapOutAmount,
      contract_input,
      status: 0,
    };

    return formatted_output;
  } else {
    return result;
  }
}

export async function calc_profit(
  borrowAmount: string,
  borrowAddress: string,
  poolcheap: LpPool | string,
  poolexp: LpPool | string
) {
  const { lp_pool: lp_poolcheap, poolparam: poolcheapparam } =
    await unpackPoolParam(poolcheap);
  const { lp_pool: lp_poolexp, poolparam: poolexpparam } =
    await unpackPoolParam(poolexp);

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "calc_profit",
    borrowAmount,
    borrowAddress,
    JSON.stringify(poolcheapparam),
    JSON.stringify(poolexpparam),
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param, "custom");
  });
  if (result.status == 0) {
    let datastr = result.data;
    datastr = datastr.replace(/\s/g, "");
    return Number(datastr);
  } else {
    return result;
  }
}

// Calculate profit using external contract call 
export async function calcProfitExternal(
  borrowAmount: string,
  borrowAddress: string,
  pool1: string,
  pool2: string
) {
  let pool1obj: LpPool, pool2obj: LpPool;
  let poolcheap: LpPool, poolexp: LpPool;

  pool1obj = new LpPool({ address: pool1 });
  pool2obj = new LpPool({ address: pool2 });

  await pool1obj.init();
  await pool2obj.init();
  const p1price = await pool1obj.getSpotPrice();
  const p2price = await pool2obj.getSpotPrice();

  if (p1price < p2price) {
    poolcheap = pool2obj;
    poolexp = pool1obj;
  } else {
    poolcheap = pool1obj;
    poolexp = pool2obj;
  }

  const repayAmount = ethers.BigNumber.from(
    (await poolcheap.swapAmount(borrowAmount, borrowAddress, false))?.input
      .amountInt
  );
  const swapOutAmount = ethers.BigNumber.from(
    (await poolexp.swapAmount(borrowAmount, borrowAddress, true))?.output
      .amountInt
  );
  const profit = swapOutAmount.sub(repayAmount);
  return {
    borrowAmount,
    profitAmount: profit.toString(),
    repayAmount: repayAmount.toString(),
    swapOutAmount: swapOutAmount.toString(),
    pool1: poolcheap.address,
    pool2: poolexp.address,
  };
}

export async function getSpotPrice(
  pool: LpPool | string,
  baseCurrency: string
) {
  const { lp_pool, poolparam } = await unpackPoolParam(pool);

  const param = [
    "../../univ3py/univ3py_main/router.py",
    "getSpotPrice",
    JSON.stringify(poolparam),
    baseCurrency,
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param, "custom");
  });
  if (result.status == 0) {
    let datastr = result.data;
    datastr = datastr.replace(/\s/g, "");
    return Number(datastr);
  } else {
    return result;
  }
}

// return pool param for python functions
export async function unpackPoolParam(pool: string | LpPool) {
  let lp_pool: LpPool;
  if (typeof pool === "string") {
    lp_pool = new LpPool({ address: pool });
    await lp_pool.init();
  } else {
    lp_pool = pool;
  }
  try {
    await lp_pool.init();
  } catch {
    console.log(pool);
    return { poolparam: { lp_pool: pool, status: 1 } };
  }
  const poolType = lp_pool.poolType;
  // Pool params
  let poolparam,
    status = 0;
  let poolAddress,
    token0Address,
    token1Address,
    token0Decimal,
    token1Decimal,
    token0balance,
    token1balance;
  poolAddress = lp_pool.address;

  if (lp_pool.token0 && lp_pool.token1) {
    token0Address = lp_pool.token0.address;
    token1Address = lp_pool.token1.address;
    token0Decimal = lp_pool.token0.decimals;
    token1Decimal = lp_pool.token1.decimals;
  } else {
    status = 1;
  }
  if (lp_pool.balance) {
    if (lp_pool.balance.token0 && lp_pool.balance.token1) {
      token0balance = lp_pool.balance.token0.toString();
      token1balance = lp_pool.balance.token1.toString();
    }
  }

  if (poolType === "uniswapV3") {
    const sqrtPriceX96 = lp_pool.State!.sqrtPriceX96.toString();
    const liquidity = lp_pool.State!.liquidity.toString();
    const fee = lp_pool.Immutables!.fee;
    const currentTick = lp_pool.State!.tick;
    const tickSpacing = lp_pool.Immutables!.tickSpacing;
    const tickMapraw = await lp_pool.getTickMap(undefined, 1);
    const tickMap = tickMapraw.map(
      (row: { tick: any; liquidityNet: any; liquidityGross: any }) => [
        row.tick,
        row.liquidityNet.toString(),
        row.liquidityGross.toString(),
      ]
    );

    poolparam = {
      poolAddress,
      poolType,
      token0Address,
      token1Address,
      token0Decimal,
      token1Decimal,
      token0balance,
      token1balance,
      sqrtPriceX96,
      liquidity,
      fee,
      currentTick,
      tickSpacing,
      tickMap,
      status,
    };
  }

  if (poolType === "uniswapV2") {
    const reserve = await lp_pool.updateReservesV2();
    poolparam = {
      poolAddress,
      poolType,
      token0Address,
      token1Address,
      token0Decimal,
      token1Decimal,
      token0balance,
      token1balance,
      reserve0: reserve.reserve0.toString(),
      reserve1: reserve.reserve1.toString(),
      status,
    };
  }

  return { lp_pool, poolparam };
}

// Find relevant pools in DB given token pairs
async function findRelevantPools(
  token0Address?: string,
  token1Address?: string
) {
  let allPools = [];
  if (!token0Address || !token1Address) return [];
  const baseTokenAddress = address.token.weth;

  if (
    token0Address === baseTokenAddress ||
    token1Address === baseTokenAddress
  ) {
    const db_result = (
      await query_db(
        `SELECT address,fee,pool_type FROM lp_pool WHERE (token0_address='${token0Address}' AND token1_address='${token1Address}') OR (token0_address='${token1Address}' AND token1_address='${token0Address}')`
      )
    ).rows;

    if (db_result.length > 0) {
      for (let pool of db_result) {
        let newpool = new LpPool({ address: pool.address });
        await newpool.init();

        const liquidity_threshold = ethers.utils.parseUnits("2", "ether");
        const liquidity: ethers.BigNumber =
          newpool.token0?.address === baseTokenAddress
            ? newpool.balance?.token0
            : newpool.balance?.token1;

        // If pool have enough tokens to compare
        if (liquidity) {
          if (liquidity.gt(liquidity_threshold)) {
            await newpool.getSpotPrice();
            allPools.push(newpool);
          }
        }
      }
    }
  }

  return allPools;
}

function comparePools(pools: any[]) {
  if (pools.length < 2) return [{ pool: [], diff: 0 }];

  let result = [];
  //Compare all pools combination and percentage differences
  for (let i = 0; i < pools.length - 1; i++) {
    // This is where you'll capture that last value
    for (let j = i + 1; j < pools.length; j++) {
      const pairFees = (Number(pools[i].fee) + Number(pools[j].fee)) / 1000000;
      const diff = Math.abs(
        Number(pools[i].rate!.price) - Number(pools[j].rate!.price)
      );
      const max_rate = Math.max(
        Number(pools[i].rate!.price),
        Number(pools[j].rate!.price)
      );
      const percent_diff = (diff / max_rate - pairFees) * 100;
      if (percent_diff > 0) {
        result.push({ pool: [pools[i], pools[j]], diff: percent_diff });
      }
    }
  }

  if (result.length === 0) return [{ pool: [], diff: 0 }];
  const sorted = result.sort((a, b) => b.diff - a.diff);
  // returning first three pool
  return sorted.slice(0, 3).map((pairs) => pairs.pool);
}

// Calculate profits from multiple pairs of pools and return the best profit
export async function optimizeV3Bulk(poolPairs: any[]) {
  const allprofits = await Promise.all(
    poolPairs.map(async (pairs) => {
      let pairProfit;
      if (pairs.length === 2) {
        pairProfit = optimizeV3(pairs[0], pairs[1]);
      } else {
        pairProfit = { profitAmount: 0, status: 1 };
      }
      return pairProfit;
    })
  );

  // Sort by profitAmount and return the first element(max profit)
  let maxprofit,checkProfit
  maxprofit = allprofits.sort(
    (a, b) => b.profitAmount - a.profitAmount
  )[0];

  // Double Check and adjust inaccurate amounts
  if (maxprofit.status===0){
    checkProfit = await calcProfitExternal(
      maxprofit.borrowAmount,
      maxprofit.contract_input.tokenBorrow,
      maxprofit.contract_input.pool1,
      maxprofit.contract_input.pool2
    );

    maxprofit.profitAmount = checkProfit.profitAmount
    if(checkProfit.repayAmount==0){
      maxprofit.contract_input.repayAmount = checkProfit.repayAmount
      maxprofit.repayAmount = checkProfit.repayAmount
      maxprofit.profitAmount = 0
    }
    maxprofit.swapOutAmount = checkProfit.swapOutAmount
    maxprofit.contract_input.swapOutAmount = checkProfit.swapOutAmount
  }

  return maxprofit;
}

// Find the best pair profit from the relevant pools
export async function findBestProfit(
  token0Address?: string,
  token1Address?: string
) {
  // Get relevant pools
  const mpools: LpPool[] = await findRelevantPools(
    token0Address,
    token1Address
  );

  // Compare pools
  const top_rates = comparePools(mpools);
  const bestProfit = await optimizeV3Bulk(top_rates);

  return bestProfit;
}

