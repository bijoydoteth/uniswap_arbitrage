import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter, SwapToRatioStatus } from "@uniswap/smart-order-router";
import { abi as IUniswapV3FactoryABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";
import {
  ContractCallContext,
  ContractCallResults,
  ContractCallReturnContext,
  Multicall
} from "ethereum-multicall";
import { ethers } from "ethers";
import { mul } from "prb-math";
import { PythonShell } from "python-shell";
import { start } from "repl";
import { forEachLeadingCommentRange } from "typescript";
import { getProvider } from "../settings/provider";
import { query_db } from "../settings/setupdb";
import { address } from "./address";
import { Erc20, getErc20 } from "./arbitrageobject/erc20";
import {
  LpPool,
  LpPools,
  v2_pool_abi,
  v3_pool_abi
} from "./arbitrageobject/lpPool";
import graphData from "./graphdata.json";

const provider = getProvider("node", "rpc");
const pythonRouterPath = "../py_calculations/router.py"

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

export function run_python(
  callback: {
    (data: any): Promise<void>;
    (arg0: { data: string; status: number }): void;
  },
  param: any
) {
  let pyshell = new PythonShell(param[0], { mode: "text" });
  for (const arg of param) {
    pyshell.send(arg);
  }

  pyshell.on("message", function (message) {
    callback({ data: message, status: 0 });
  });
  pyshell.end(function (err, code, signal) {
    if (err) {
      callback({ data: err, status: 1 });
    }
    // console.log('The exit code was: ' + code);
  });
}

export async function test_run_python(message: string) {
  const param = [pythonRouterPath, "test", message];

  const result: any = await new Promise(function (resolve, reject) {
    run_python(async (data) => resolve(data), param);
  });

  if (result.status == 0) {
    let data = result.data;
    return data;
  } else {
    return result;
  }
}

export async function getEthPriceInUSD(){
  const feedABI = [{"inputs":[{"internalType":"address","name":"_aggregator","type":"address"},{"internalType":"address","name":"_accessController","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"int256","name":"current","type":"int256"},{"indexed":true,"internalType":"uint256","name":"roundId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"updatedAt","type":"uint256"}],"name":"AnswerUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"roundId","type":"uint256"},{"indexed":true,"internalType":"address","name":"startedBy","type":"address"},{"indexed":false,"internalType":"uint256","name":"startedAt","type":"uint256"}],"name":"NewRound","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"OwnershipTransferRequested","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"inputs":[],"name":"acceptOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"accessController","outputs":[{"internalType":"contract AccessControllerInterface","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"aggregator","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_aggregator","type":"address"}],"name":"confirmAggregator","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"description","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_roundId","type":"uint256"}],"name":"getAnswer","outputs":[{"internalType":"int256","name":"","type":"int256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint80","name":"_roundId","type":"uint80"}],"name":"getRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_roundId","type":"uint256"}],"name":"getTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestAnswer","outputs":[{"internalType":"int256","name":"","type":"int256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestRound","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address payable","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint16","name":"","type":"uint16"}],"name":"phaseAggregators","outputs":[{"internalType":"contract AggregatorV2V3Interface","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"phaseId","outputs":[{"internalType":"uint16","name":"","type":"uint16"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_aggregator","type":"address"}],"name":"proposeAggregator","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"proposedAggregator","outputs":[{"internalType":"contract AggregatorV2V3Interface","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint80","name":"_roundId","type":"uint80"}],"name":"proposedGetRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"proposedLatestRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_accessController","type":"address"}],"name":"setController","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_to","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]
  const ethPriceContract = new ethers.Contract(address.chainlink.ethusd,feedABI,provider)
  return (await ethPriceContract.latestRoundData()).answer.toString()/10**8
}

// Filter unique event logs from a list of logs on each block
export function filterUniqueLastLog(
  logs: {
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    removed: boolean;
    address: string;
    data: string;
    topics: string[];
    transactionHash: string;
    logIndex: number;
  }[]
) {
  let originalLogs = logs;
  let tempLogs;
  let filterLogs: {
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    removed: boolean;
    address: string;
    data: string;
    topics: string[];
    transactionHash: string;
    logIndex: number;
  }[] = [];
  for (const idx in originalLogs) {
    tempLogs = originalLogs.filter(
      (log) =>
        log.address === originalLogs[idx].address &&
        log.topics[0] === originalLogs[idx].topics[0]
    );
    tempLogs = tempLogs.sort((a, b) => b.logIndex - a.logIndex);
    tempLogs = tempLogs[0];
    if (!filterLogs.includes(tempLogs)) {
      filterLogs.push(tempLogs);
    }
  }

  return filterLogs.sort((a, b) => a.logIndex - b.logIndex);
}

// Uniswap V3 calculations
export async function getSqrtRatioX96FromTick(tick: number) {
  const param = [
    pythonRouterPath,
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
    pythonRouterPath,
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
      pythonRouterPath,
      "getAmount0Delta",
      sqrtRatioAfterX96.toString(),
      sqrtRatioBeforeX96.toString(),
      liquidity.toString(),
      roundUp,
    ];
  } else {
    param = [
      pythonRouterPath,
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
    pythonRouterPath,
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
    pythonRouterPath,
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
    run_python(async (data) => resolve(data), param);
  });
  if (result.status == 0) {
    let datastr = JSON.parse(result.data);

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
    pythonRouterPath,
    "calc_profit",
    borrowAmount,
    borrowAddress,
    JSON.stringify(poolcheapparam),
    JSON.stringify(poolexpparam),
  ];

  const result: any = await new Promise(function (resolve, reject) {
    run_python(async (data) => resolve(data), param);
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
  const p1price = (await pool1obj.getSpotPrice()).price;
  const p2price = (await pool2obj.getSpotPrice()).price;

  if (p1price < p2price) {
    poolcheap = pool2obj;
    poolexp = pool1obj;
  } else {
    poolcheap = pool1obj;
    poolexp = pool2obj;
  }

  const repayAmount = ethers.BigNumber.from(
    (await poolcheap.swapAmountQuote(borrowAmount, borrowAddress, false))?.input
      .amountInt
  );
  const swapOutAmount = ethers.BigNumber.from(
    (await poolexp.swapAmountQuote(borrowAmount, borrowAddress, true))?.output
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
  baseCurrency: string,
  feeAdjusted: boolean = false
) {
  const { lp_pool, poolparam } = await unpackPoolParam(pool);

  const param = [
    pythonRouterPath,
    "getSpotPrice",
    JSON.stringify(poolparam),
    baseCurrency,
    feeAdjusted,
  ];

  const result: any = await new Promise(function (resolve, reject) {
    run_python(async (data) => resolve(data), param);
  });
  if (result.status == 0) {
    let datastr = result.data;
    datastr = JSON.parse(datastr);
    return Number(datastr[0]);
  } else {
    return result;
  }
}

export async function getSpotRatioFast(
  poolAddress: string,
  isToken0: boolean,
  withInput: boolean,
  inputParam?: { reserve0?: Number; reserve1?: Number; sqrtPriceX96?: Number }
) {
  const query_result = (
    await query_db(
      `SELECT token0_address,token1_address,fee,pool_type FROM lp_pool WHERE address='${poolAddress}'`
    )
  ).rows;
  let ratio, ratiof, from, to;
  let reserve0, reserve1, sqrtPriceX96;
  if (inputParam) {
    reserve0 = inputParam.reserve0;
    reserve1 = inputParam.reserve1;
    sqrtPriceX96 = inputParam.sqrtPriceX96;
  }

  if (query_result.length === 1) {
    const row = query_result[0];
    if (!withInput) {
      let timestamp;
      if (row.pool_type === "uniswapV3") {
        const contract = new ethers.Contract(
          poolAddress,
          v3_pool_abi,
          provider
        );
        sqrtPriceX96 = (await contract.slot0())[0];
      } else if (row.pool_type === "uniswapV2") {
        [reserve0, reserve1, timestamp] = await new ethers.Contract(
          poolAddress,
          v2_pool_abi,
          provider
        ).getReserves();
      }
    }

    if (row.pool_type === "uniswapV3") {
      ratio = sqrtPriceX96 ** 2 / 2 ** 192;
    } else if (row.pool_type === "uniswapV2") {
      ratio = reserve1 / reserve0;
    }
    if (ratio) {
      if (isToken0) {
        from = row.token0_address;
        to = row.token1_address;
      } else {
        ratio = 1 / ratio;
        from = row.token1_address;
        to = row.token0_address;
      }
      ratiof = (1 - row.fee) * ratio;
    } else {
      ratio = 0;
      ratiof = 0;
    }

    return { ratio,ratiof, from, to,poolAddress };
  } else {
    return { ratio:0,ratiof: 0, from, to,poolAddress};
  }
}

export async function getSpotRatioFastBulk(
  poolAddresses: string[],
  isToken0: boolean,
) {
  const query_result = (
    await query_db(
      `SELECT address,token0_address,token1_address,fee,pool_type FROM lp_pool WHERE address IN (${poolAddresses
        .map((row: string) => "'" + row + "'")
        .toString()});`
    )
  ).rows;

  const multicall = new Multicall({
    ethersProvider: provider,
    tryAggregate: true,
  });
  
  const contractCallContext: ContractCallContext[] = query_result.map(e=>{
    if (e.pool_type==='uniswapV3'){
      return{
        reference: e.address,
        contractAddress: e.address,
        abi: v3_pool_abi,
        calls: [
          {
            reference: "slot0",
            methodName: "slot0()",
            methodParameters: [],
          }
        ], 
      }
    }else if(e.pool_type==='uniswapV2'){
      return{
        reference: e.address,
        contractAddress: e.address,
        abi: v2_pool_abi,
        calls: [
          {
            reference: "getReserves",
            methodName: "getReserves()",
            methodParameters: [],
          }
        ], 
      }  
    }else{
      return{
        reference: e.address,
        contractAddress: e.address,
        abi: v2_pool_abi,
        calls: [
        
        ], 
      }  
    }
  })

  let callresult: { [x: string]: ContractCallReturnContext | { callsReturnContext: { returnValues: any; }[]; }; }
  try {
    callresult = (await multicall.call(contractCallContext)).results

  } catch (err: any) {
    
    console.log(`Multicall error: ${err.reason}`);
  }
  
  const spotratios = query_result.map(pool=>{
    const poolResult = callresult[pool.address].callsReturnContext[0].returnValues
    let ratio, ratiof, from, to;
    if(pool.pool_type==='uniswapV3'){
      ratio = ethers.BigNumber.from(poolResult[0].hex) ** 2 / 2 ** 192;

    }else if(pool.pool_type==='uniswapV2'){
      const reserve0 = ethers.BigNumber.from(poolResult[0].hex)
      const reserve1 = ethers.BigNumber.from(poolResult[1].hex)

      if (reserve0==0){
        ratio = 0
      }else{
        ratio = reserve1 / reserve0;
      }
      
    }else{

    }
    if (ratio) {
      if (isToken0) {
        from = pool.token0_address;
        to = pool.token1_address;
      } else {
        if(ratio!==0){
          ratio = 1 / ratio;
        }
        from = pool.token1_address;
        to = pool.token0_address;
      }
      ratiof = (1 - pool.fee) * ratio;
    } else {
      ratio = 0;
      ratiof = 0;
    }

    return { ratio,ratiof, from, to , poolAddress:pool.address};
  })
  
  return spotratios
} 

// return pool param for python functions input
export async function unpackPoolParam(pool: string | LpPool) {
  let lp_pool: LpPool;
  if (typeof pool === "string") {
    lp_pool = new LpPool({ address: pool });
    await lp_pool.init();
  } else {
    lp_pool = pool;
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

  token0Address = lp_pool.token0!.address;
  token1Address = lp_pool.token1!.address;
  token0Decimal = lp_pool.token0!.decimals;
  token1Decimal = lp_pool.token1!.decimals;
  token0balance = lp_pool.balance!.token0.toString();
  token1balance = lp_pool.balance!.token1.toString();

  if (poolType === "uniswapV3") {
    const sqrtPriceX96 = lp_pool.State!.sqrtPriceX96.toString();
    const liquidity = lp_pool.State!.liquidity.toString();
    const fee = lp_pool.Immutables!.fee;
    const currentTick = lp_pool.State!.tick;
    const tickSpacing = lp_pool.Immutables!.tickSpacing;
    const tickMapraw = await lp_pool.getTickMapMulti();

    const tickMap = (tickMapraw.result).map((row: any) => [
      row[0],
      ethers.BigNumber.from(row[1].hex).toString(),
      ethers.BigNumber.from(row[2].hex).toString(),
    ]);

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
    const reserve = lp_pool.v2!;
    poolparam = {
      poolAddress,
      poolType,
      token0Address,
      token1Address,
      token0Decimal,
      token1Decimal,
      token0balance,
      token1balance,
      fee: 3000,
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
  let maxprofit, checkProfit;
  maxprofit = allprofits.sort((a, b) => b.profitAmount - a.profitAmount)[0];

  // Double Check and adjust inaccurate amounts
  if (maxprofit.status === 0) {
    checkProfit = await calcProfitExternal(
      maxprofit.borrowAmount,
      maxprofit.contract_input.tokenBorrow,
      maxprofit.contract_input.pool1,
      maxprofit.contract_input.pool2
    );

    maxprofit.profitAmount = checkProfit.profitAmount;
    if (checkProfit.repayAmount == 0) {
      maxprofit.contract_input.repayAmount = checkProfit.repayAmount;
      maxprofit.repayAmount = checkProfit.repayAmount;
      maxprofit.profitAmount = 0;
    }
    maxprofit.swapOutAmount = checkProfit.swapOutAmount;
    maxprofit.contract_input.swapOutAmount = checkProfit.swapOutAmount;
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

export async function updateSpotPrice(poolAddress: string) {
  const param = [
    "../../arbitrage_v2/scripts/router.py",
    "updateSpotPrice",
    [poolAddress],
  ];

  const result: any = await new Promise(function (resolve, reject) {
    call_python(async (data) => resolve(data), param);
  });
  if (result.status === 0) {
    return result.data;
  } else {
    return result;
  }
}

// Find V3 new pool from existing token from the DB
// export async function getnewPool(TokenAddress?: string) {
//   const uniswap_v3_factory = address.dex.uniswap.v3.factory;
//   const factory_contract = new ethers.Contract(
//     uniswap_v3_factory,
//     IUniswapV3FactoryABI,
//     provider
//   );

//   const token0 = address.token.weth;

//   const dex_name = "uniswap_v3";
//   const pool_type = "uniswapV3";
//   const router_address = address.dex.uniswap.v3.router;
//   const network = "ethereum";
//   const fee_bps = [0.0001,0.0005, 0.003, 0.01];

//   let query_result = (await query_db(`SELECT address FROM erc20_contract`))
//     .rows;
//   const startFromToken = 3000;
//   query_result.splice(0, startFromToken);

//   if (TokenAddress) {
//     query_result = [{ address: TokenAddress }];
//   }
//   let totalToken = query_result.length;
//   let counter = 1;
//   console.log(`Searching for ${totalToken} tokens pools that paired with WETH`);
//   let startTime, endTime;
//   startTime = performance.now();

//   for (const row of query_result) {
//     const token1 = row.address;

//     let token0_address, token1_address;
//     if (token0.toLowerCase() < token1.toLowerCase()) {
//       token0_address = token0;
//       token1_address = token1;
//     } else {
//       token0_address = token1;
//       token1_address = token0;
//     }

//     for (const fee of fee_bps) {
//       const lp_address = await factory_contract.getPool(
//         token0,
//         token1,
//         fee * 1000000
//       );
//       if (lp_address !== ethers.constants.AddressZero) {
//         const query_string = `INSERT INTO lp_pool (address,network,dex_name,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${lp_address}','${network}','${dex_name}','${token0_address}','${token1_address}','${router_address}',${fee},'${pool_type}') ON CONFLICT DO NOTHING;`;
//         query_db(query_string);
//         // console.log(`Pool: ${lp_address}`)
//       }
//     }
//     counter += 1;
//     if (counter % 1000 === 0) {
//       endTime = performance.now();
//       const totaltime =
//         Math.round(((endTime - startTime) / 1000) * 1000) / 1000;
//       console.log(`Progress: ${counter} / ${totalToken} | Time: ${totaltime}s`);
//       startTime = performance.now();
//     }
//   }
// }

// Graph updating and helper function

export async function constructGraphObjectFromDB(liquidity_criteria:string='medium') {
  const dbgraphData = (
    await query_db(
      `SELECT address,token0_address,token1_address,spot_ratio_f_0to1,spot_ratio_f_1to0,spot_ratio_timestamp,base_value_locked_usd FROM lp_pool WHERE liquidity_criteria_${liquidity_criteria}=true AND blacklist=false;`
    )
  ).rows;
  const unique = (value: any, index: any, self: string | any[]) => {
    return self.indexOf(value) === index;
  };

  const edgelist = dbgraphData
    .map((row) => {
      const timestamp = row.spot_ratio_timestamp;
      let ratiof0to1, ratiof1to0, weight0to1, weight1to0;
      let result = [];
      if (row.spot_ratio_f_0to1 > 0) {
        ratiof0to1 = row.spot_ratio_f_0to1;
        weight0to1 = -Math.log(ratiof0to1);

        result.push({
          ratiof: ratiof0to1,
          weight: weight0to1,
          liquidityUSD:row.base_value_locked_usd,
          timestamp,
          source: row.token0_address,
          target: row.token1_address,
          key: row.address,
        });
      }
      if (row.spot_ratio_f_1to0 > 0) {
        ratiof1to0 = row.spot_ratio_f_1to0;
        weight1to0 = -Math.log(ratiof1to0);

        result.push({
          ratiof: ratiof1to0,
          weight: weight1to0,
          liquidityUSD:row.base_value_locked_usd,
          timestamp,
          source: row.token1_address,
          target: row.token0_address,
          key: row.address,
        });
      }

      return result;
    })
    .flat();

  // Convert multigraph edges into digraph edges
  const digraph_edgelist = edgelist
    .map((edge) => {
      let duplicated_edges = edgelist.filter(
        (row) => row.source === edge.source && row.target === edge.target
      );
      // Filter edge based on liquidity locked in USD
      // duplicated_edges = duplicated_edges.sort((a, b) => a.weight - b.weight);
      duplicated_edges = duplicated_edges.sort((a, b) => b.liquidityUSD - a.liquidityUSD);
      if (edge.liquidityUSD === duplicated_edges[0].liquidityUSD) {
        return edge;
      } else {
        return [];
      }
    })
    .flat();

  const tokenlist = dbgraphData
    .map((row) => {
      return [row.token0_address, row.token1_address];
    })
    .flat()
    .filter(unique);
  let query_string = `SELECT symbol,decimals,address as id FROM erc20_contract WHERE address IN (${tokenlist
    .map((row) => "'" + row + "'")
    .toString()});`;
  const nodelist = (await query_db(query_string)).rows;

  const graphObject = {
    directed: true,
    multigraph: false,
    graph: {},
    nodes: nodelist,
    links: digraph_edgelist,
  };

  return graphObject;
}

export async function loadGraphObjectToDB(Graph:Object){
  await query_db(
    `UPDATE graph_db SET graph_object = '${JSON.stringify(Graph)}' WHERE graph_number=1`
  );
  console.log("Graph updated to DB.");
}

export async function loadGraphFromDB(){
  const graph = (
    await query_db(`SELECT graph_object FROM graph_db WHERE graph_number=1;`)
  ).rows[0].graph_object;
  return graph
}

export async function updateGraphObjectFromDB(){
  await loadGraphObjectToDB(await constructGraphObjectFromDB())
}

export async function convertLogtoDBQuery(
  decodelog:
    | {
        original: {
          blockNumber: number;
          blockHash: string;
          transactionIndex: number;
          removed: boolean;
          address: string;
          data: string;
          topics: string[];
          transactionHash: string;
          logIndex: number;
        };
        decode: any;
      }
    | undefined
) {
  let spot0to1, spot1to0, weight0to1, weight1to0
  let edgePair:{key:string,ratiof:number,source:string,target:string,weight:number,timestamp?:number}[]=[], updateDB;
  let update_string = '',select_string=''
  const timestamp = Math.floor(Date.now() / 1000);
  const logArgs = decodelog?.decode.args;
  if (
    decodelog &&
    decodelog.decode.topic ===
      "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
  ) {
    spot0to1 = await getSpotRatioFast(decodelog.original.address, true, true, {
      sqrtPriceX96: logArgs.sqrtPriceX96,
    });
    spot1to0 = await getSpotRatioFast(decodelog.original.address, false, true, {
      sqrtPriceX96: logArgs.sqrtPriceX96,
    });
  } else if (
    decodelog &&
    decodelog.decode.topic ===
      "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
  ) {
    spot0to1 = await getSpotRatioFast(decodelog.original.address, true, true, {
      reserve0: logArgs.reserve0,
      reserve1: logArgs.reserve1,
    });
    spot1to0 = await getSpotRatioFast(decodelog.original.address, false, true, {
      reserve0: logArgs.reserve0,
      reserve1: logArgs.reserve1,
    });
    
  } else {
    console.log("Log decode error");
    return {edgePair,updateDB};
  }

  if (spot0to1.ratiof !== 0) {
    weight0to1 = -Math.log(spot0to1.ratiof);
    weight1to0 = -Math.log(spot1to0.ratiof);
    update_string = `UPDATE lp_pool SET spot_ratio_f_0to1=${spot0to1.ratiof},spot_ratio_f_1to0=${spot1to0.ratiof},spot_ratio_timestamp=${timestamp} WHERE address='${decodelog.original.address}'; `
    select_string = `SELECT address,spot_ratio_f_0to1,spot_ratio_f_1to0,spot_ratio_timestamp,token0_address,token1_address,base_value_locked_usd FROM lp_pool WHERE blacklist=false AND liquidity_criteria_medium=true AND ((token0_address='${spot0to1.from}' AND token1_address='${spot0to1.to}') OR (token0_address='${spot0to1.to}' AND token1_address='${spot0to1.from}'));`

    return {updateDB:[update_string,select_string]};
  }else{
    return {updateDB}
  }
}

export function convertDBQuerytoEdges(queryObject: { address: any; spot_ratio_f_0to1: number; token0_address: any; token1_address: any;base_value_locked_usd:any; spot_ratio_timestamp: any; spot_ratio_f_1to0: number; }){

    const edgePair = [
        {
          key: queryObject.address,
          ratiof: queryObject.spot_ratio_f_0to1,
          source: queryObject.token0_address,
          target: queryObject.token1_address,
          weight: -Math.log(queryObject.spot_ratio_f_0to1),
          liquidityUSD: queryObject.base_value_locked_usd,
          timestamp:queryObject.spot_ratio_timestamp,
        },
        {
          key: queryObject.address,
          ratiof: queryObject.spot_ratio_f_1to0,
          source: queryObject.token1_address,
          target: queryObject.token0_address,
          weight: -Math.log(queryObject.spot_ratio_f_1to0),
          timestamp:queryObject.spot_ratio_timestamp,
        },
      ]
    return edgePair

}

export async function updateEdges(
  edgeObjects: {
    key: string;
    ratiof: number;
    weight: number;
    liquidityUSD:number;
    source?: string;
    target?: string;
    timestamp?: number;
  }[]
) {
  let graph = (
    await query_db(`SELECT graph_object FROM graph_db WHERE graph_number=1;`)
  ).rows[0].graph_object;
  let edges = graph.links;
  // Filter out the lowest weight unique edges from the edgeObjects input
  let uniqueEdges = edgeObjects.map(edgeObject=>{
    const relevantEdges = edgeObjects.filter(e=>(e.source===edgeObject.source && e.target===edgeObject.target))
    const lowestWeightEdge = relevantEdges.sort((a,b)=>b.liquidityUSD-a.liquidityUSD)[0]
    if (edgeObject.liquidityUSD===lowestWeightEdge.liquidityUSD){
      return lowestWeightEdge
    }else{
      return []
    }
  }).flat()

  let graph_result = uniqueEdges.map((edgeObject) => {
    let pooledges = edges
      .map((elm: { key: string; source: string; target:string;ratiof:number,weight:number,timestamp:number }, idx: any) =>
        (elm.source === edgeObject.source && elm.target === edgeObject.target)
          ? {index:idx,key:elm.key,ratiof:elm.ratiof,weight:elm.weight,timestamp:elm.timestamp,source:elm.source,target:elm.target}
          : ""
      )
      .filter(String);

    if (pooledges.length === 1) {
      // If new pool is same as edge key, update edge
      // If new weight is smaller than the graph weight, update edge
      if(edgeObject.key===pooledges[0].key || edgeObject.weight<pooledges[0].weight){
        const timestamp = Math.floor(Date.now() / 1000);
        graph.links[pooledges[0].index].key = edgeObject.key
        graph.links[pooledges[0].index].ratiof = edgeObject.ratiof;
        graph.links[pooledges[0].index].weight = edgeObject.weight;
        graph.links[pooledges[0].index].timestamp = timestamp;

        return {
          msg: `Edge Updated | Pool: ${edgeObject.key} | From: ${edgeObject.source} | To: ${edgeObject.target} | Time: ${timestamp}`,
          data:edgeObject,
          status: 0,
        };
      }else{
        return {
          msg: `Edge do not need update | Pool ${edgeObject.key} | From: ${edgeObject.source} | To: ${edgeObject.target}`,
          data:edgeObject,
          status: 2,
        };
      }
    } else{
      return { msg: "Edge not found in graph",data:edgeObject, status: 1 };
    }
  });

  let update_string = `UPDATE graph_db SET graph_object = '${JSON.stringify(
    graph
  )}' WHERE graph_number=1;`;

  await query_db(update_string);

  const summary = graph_result.filter((row) => row.status === 0);
  const msg = summary.map((row) => row.msg)
  const updatedEdges = summary.map((row) => row.data)
  const uniqueEdgesPath:any = updatedEdges.filter((item, index, self) => {
    return self.findIndex((t) => (t.source === item.source && t.target === item.target)||(t.source === item.target && t.target === item.source)) === index;
  }).map(e=>{return [e.source, e.target]});

  return {msg,updatedEdges,uniqueEdgesPath};
}

// Convert event logs of each block to edges while updating the DB and graphs
export async function convertLogsToEdges(logs: { blockNumber: number; blockHash: string; transactionIndex: number; removed: boolean; address: string; data: string; topics: string[]; transactionHash: string; logIndex: number; }[]){
  const iface = new ethers.utils.Interface([
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
    "event Sync(uint112 reserve0, uint112 reserve1)",
  ]);

  const filterlogs = filterUniqueLastLog(logs)
      
  const convertResult = await Promise.all(filterlogs.map(async log=>{
    try{
      const decodelog =  {original:log,decode:iface.parseLog(log)};
      const result = await convertLogtoDBQuery(decodelog)

      return result
    }catch(err){
      console.log(err)
      return {updateDB:undefined}
    }
  }))
  const query_strings = (convertResult.map(e=>e.updateDB)).filter(e=>e!==undefined)
  const update_strings = query_strings.map(e=>e![0]).join('')
  const select_strings = query_strings.map(e=>e![1]).join('')

  let relatedEdgeData:any = (await query_db(update_strings.concat(select_strings)))
  relatedEdgeData = relatedEdgeData.map((e: { rows: any; })=>e.rows)
  relatedEdgeData = relatedEdgeData.filter((item: any[]) => {
    return Array.isArray(item) && item.length > 0;
  })

  
  const edges = ((relatedEdgeData.flat()).map((e: { address: any; spot_ratio_f_0to1: number; token0_address: any; token1_address: any; spot_ratio_timestamp: any; spot_ratio_f_1to0: number; base_value_locked_usd:number; })=>convertDBQuerytoEdges(e))).flat()
  
  const update_result = await updateEdges(edges)
  return update_result
}

export async function updateAllEdgesInGraph() {
  console.log('Start updating edges')
  await updateAllEdgesInDB()
  const graph = await constructGraphObjectFromDB()
  await loadGraphObjectToDB(graph)
  console.log('All edges from graph has been updated.')
  
}

export async function updateAllEdgesInDB() {
  const uniquePools = (
    await query_db(`SELECT address FROM lp_pool WHERE liquidity_criteria_low=true AND blacklist=false;`)
  ).rows.map((row) => row.address);
  const uniquePoolsNum = uniquePools.length;
  const chunksize = 1000
  const iteration = Math.ceil(uniquePoolsNum / chunksize)
  let counter=0
  for (let i=0;i<iteration;i++){
    const chunk = uniquePools.splice(0,chunksize)

    const spotratioResult0to1 = (await getSpotRatioFastBulk(chunk,true))!.map(e=>{
      return{ratiof:e.ratiof,poolAddress:e.poolAddress,is0to1:true}
    })
    const spotratioResult1to0 = (await getSpotRatioFastBulk(chunk,false))!.map(e=>{
      return{ratiof:e.ratiof,poolAddress:e.poolAddress,is0to1:false}
    })

    const spotratioResult = spotratioResult0to1!.concat(spotratioResult1to0!)
    const timestamp = Math.floor(Date.now() / 1000);
    const query_strings = chunk!.map(poolAddress=>{
      const poolResult = spotratioResult.filter(e=>e.poolAddress===poolAddress)
      if (poolResult.length===2){
        const spot0to1 = (poolResult.filter(e=>e.is0to1===true))[0].ratiof
        const spot1to0 = (poolResult.filter(e=>e.is0to1===false))[0].ratiof
        return `UPDATE lp_pool SET spot_ratio_f_0to1=${spot0to1},spot_ratio_f_1to0=${spot1to0},spot_ratio_timestamp=${timestamp} WHERE address='${poolAddress}';`
      }else{
        return ''
      }
    })
    await query_db(query_strings.join(''))
    counter = counter+query_strings.length
    console.log(`${counter}/${uniquePoolsNum} pool edges updated`)
  }
  

}

// export async function rebuildGraphFromJSON() {
//   let dataStr = JSON.stringify(graphData);
//   dataStr = dataStr.replace(/\\u0000/g, "");
//   await query_db(
//     `UPDATE graph_db SET graph_object = '${dataStr}' WHERE graph_number=1`
//   );
//   console.log("Rebuild Done.");
// }

export async function queryGraphEdge(edgeAddress: string) {
  const graph = (
    await query_db(`SELECT graph_object FROM graph_db WHERE graph_number=1;`)
  ).rows[0].graph_object;
  const lp_pool = new LpPool({address:edgeAddress})
  await lp_pool.init()

  return graph.links.filter((row: { key: string,source:string,target:string }) => (row.source === lp_pool.token0!.address && row.target === lp_pool.token1!.address)||(row.source === lp_pool.token1!.address && row.target === lp_pool.token0!.address));
}

export async function findBestProfitCycles(tokenPaths: string[][]) {

  async function determineBestProfit(profitInput: any) {
    let maxprofit = 0;
    let profitResult;
    const stableCoinList = [
      address.token.usdc,
      address.token.usdt,
      address.token.dai,
    ];
    const baseTokenList = [address.token.weth,...stableCoinList]

    profitResult = await profitInput
    .filter((e: { profit: { tokenBase: string; }; })=>baseTokenList.includes(e.profit.tokenBase))
    .reduce(
      async (
        accumulator: any,
        input: { profit: { tokenBase: string; profit: number } }
      ) => {
        let wethEquivProfit;
        if (input.profit.tokenBase === address.token.weth) {
          wethEquivProfit = Number(input.profit.profit);
        } else if (stableCoinList.includes(input.profit.tokenBase)) {
          const spotRatio = (
            await getSpotRatioFast(
              "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
              true,
              false
            )
          ).ratiof;
          wethEquivProfit = input.profit.profit * spotRatio;
          wethEquivProfit = Number(wethEquivProfit);
        } else {
          wethEquivProfit = 0;
        }

        if (wethEquivProfit > maxprofit) {
          maxprofit = wethEquivProfit;
          return input;
        }
        return accumulator;
      },
      profitInput[0]
    );

    return profitResult;
  }

  const startTime = performance.now()
  let pathResults = [];
  let finalResults: any[] = [];
  pathResults = await Promise.all(
    tokenPaths.map(async (tokenPath) => {
      const param = [
        pythonRouterPath,
        "findPossibleCyclesEdges",
        JSON.stringify(tokenPath),
      ];
      const result: any = await new Promise(function (resolve, reject) {
        run_python(async (data) => resolve(data), param);
      });

      if (result.status == 0) {
        // const bestProfit = await determineBestProfit(result.data)
        return JSON.parse(result.data);
      } else {
        console.log(result.data);
      }
    })
  );

  pathResults = pathResults.flat();

  for (const path of pathResults) {
    if (!finalResults.includes(JSON.stringify(path))) {
      finalResults.push(JSON.stringify(path));
    }
  }
  finalResults = finalResults.map((path) => JSON.parse(path));
  finalResults = finalResults.slice(0,15)
  const findPathTime = Math.round(performance.now() - startTime)/1000
  
  // Pass possible paths to calculate profits
  let poollist = finalResults.map((row: { pools: any }) => row.pools).flat();

  let multiPool = new LpPools({ pools: poollist });
  await multiPool.init();
  let profits = await Promise.all(
    finalResults.map(async (row: any) => {
      let profit = await multiPool.optimizeMultiHop(row.pools, row.tokens[1]);
      return { path: row, profit };
    })
  );

  let sortprofit = [];
  let tokenBaselist: any[] = [];
  for (const profit of profits) {
    if (!tokenBaselist.includes(profit.profit.tokenBase)) {
      let bestProfit = profits.filter(
        (row) => row.profit.tokenBase === profit.profit.tokenBase
      );
      bestProfit = bestProfit.sort((a, b) => b.profit.profit - a.profit.profit);
      sortprofit.push(bestProfit[0]);
      tokenBaselist.push(profit.profit.tokenBase);
    }
  }

  let bestProfit = await determineBestProfit(sortprofit);
  let formattedProfit,profitunit,symbolpath
  if (bestProfit){
    if(bestProfit.profit.tokenBase===address.token.weth){
      formattedProfit = (ethers.utils.formatUnits(bestProfit.profit.profit,18))
      profitunit = 'ETH'
    }else if (bestProfit.profit.tokenBase===address.token.dai){
      formattedProfit = ethers.utils.formatUnits(bestProfit.profit.profit,18)
      profitunit = 'USD'
    }else{
      formattedProfit = ethers.utils.formatUnits(bestProfit.profit.profit,6)
      profitunit = 'USD'
    }

    const allPoolTokens:any = (multiPool.pools).map(pool=>[pool.token0,pool.token1]).flat()
    symbolpath = (bestProfit.path.tokens).map((token: any)=>{
      const tokenSymbol = allPoolTokens.filter((e: any)=>e!.address===token)[0].symbol
      return tokenSymbol
    })
    
  }

  const endTime = Math.round(performance.now() - startTime)/1000

  return {bestProfit,stat:{time:{findPath:findPathTime,end:endTime},pathNum:finalResults.length,bestPath:symbolpath,formattedProfit:{amount:formattedProfit,unit:profitunit}}};
}
