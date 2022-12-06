import { ethers } from "ethers";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
import { address, baseToken } from "../address";
import {
  call_python,
  computeSwapStep, getEthPriceInUSD, getSqrtRatioX96FromTick,
  getTickFromSqrtRatioX96,
  run_python,
  unpackPoolParam
} from "../helpers";
import {
  checkErc20inDB, Erc20,
  getErc20,
  getErc20Balance,
  getPoolErc20AndBalance
} from "./erc20";

import { Token } from "@uniswap/sdk-core";
import { poolToString } from "@uniswap/smart-order-router";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import { abi as TickLensABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json";
import { Pool } from "@uniswap/v3-sdk";
import { callFlashswap } from "arbitrage_v1/uniswap_v3/callflashswap";
import {
  ContractCallContext,
  ContractCallResults,
  Multicall
} from "ethereum-multicall";
import { start } from "repl";

const BigNumber = ethers.BigNumber;
const pythonRouterPath = "../py_calculations/router.py";

export const v2_pool_abi = [
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
  "event Swap(address indexed sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function MINIMUM_LIQUIDITY() external pure returns (uint)",
  "function factory() external view returns (address)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
  "function sync() external",
];

export const v3_pool_abi = IUniswapV3PoolABI;

interface Immutables {
  factory: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  maxLiquidityPerTick: ethers.BigNumber;
}

interface State {
  liquidity: ethers.BigNumber;
  sqrtPriceX96: ethers.BigNumber;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

export class LpPool {
  address: string;
  network: string;
  provider?: any;
  poolType?: "uniswapV2" | "uniswapV3" | "other";
  contract: ethers.Contract;
  Immutables?: Immutables;
  State?: State;
  token0?: Token;
  token1?: Token;
  balance?: { token0: string; token1: string };
  rate?: { price: Number; ratio: Number; from: Token; to: Token };
  fee?: Number;
  v2?: { reserve0: string; reserve1: string; timestamp: number };
  v3TickMap?: {tickMap:any[][],tickMaprange:any[]};
  initialized?: boolean;
  error:boolean=false;

  constructor(param: any) {
    this.address = param.address;
    this.network = param.network || "ethereum";
    this.initialized = false;
  }
  
  async init(provider=getProvider()) {
    
    this.provider = provider;
    const test_contract = new ethers.Contract(
      this.address,
      v2_pool_abi,
      provider
    );
    const factory_address = await test_contract.factory();

    // Check factory address to determine uniswapV3 or V2
    if (address.dex.uniswap.v3.factory === factory_address) {
      this.poolType = "uniswapV3";
      this.contract = new ethers.Contract(
        this.address,
        IUniswapV3PoolABI,
        provider
      );
      await this.getPoolImmutablesAndState();
      const tickMapResult = await this.getTickMapMulti()
      this.v3TickMap = {tickMap:tickMapResult.result,tickMaprange:tickMapResult.range}
    } else if (address.dex.uniswap.v2.factory===factory_address || address.dex.sushiswap.factory===factory_address) {
      this.poolType = "uniswapV2";
      this.contract = new ethers.Contract(this.address, v2_pool_abi, provider);
      this.fee = 3000;
      await this.getPoolImmutablesAndState();
    }else{
      this.poolType = "other"
      this.error = true
    }

    if (!(this.token0 && this.token1)) {
      console.log(`LP Pool ${this.address} cannot fetch token`);
      this.error = true
    }
    this.initialized = true;
  }

  async getPoolImmutablesAndState() {
    const multicall = new Multicall({
      ethersProvider: this.provider,
      tryAggregate: true,
    });
    if (this.poolType === "uniswapV3") {
      
      const contractCallContext: ContractCallContext[] = [{
        reference: "lpPoolContract",
        contractAddress: this.address,
        abi: v3_pool_abi,
        calls: [
          {
            reference: "factory",
            methodName: "factory()",
            methodParameters: [],
          },
          {
            reference: "token0",
            methodName: "token0()",
            methodParameters: [],
          },
          {
            reference: "token1",
            methodName: "token1()",
            methodParameters: [],
          },
          {
            reference: "fee",
            methodName: "fee()",
            methodParameters: [],
          },
          {
            reference: "tickSpacing",
            methodName: "tickSpacing()",
            methodParameters: [],
          },
          {
            reference: "maxLiquidityPerTick",
            methodName: "maxLiquidityPerTick()",
            methodParameters: [],
          },
          {
            reference: "liquidity",
            methodName: "liquidity()",
            methodParameters: [],
          },
          {
            reference: "slot0",
            methodName: "slot0()",
            methodParameters: [],
          },
        ],
      }];
      
      try {
        const callresult = (await multicall.call(contractCallContext)).results.lpPoolContract.callsReturnContext;

        let result = callresult.map((row) => row.returnValues);
        const immutables: Immutables = {
          factory: result[0][0],
          token0: result[1][0],
          token1: result[2][0],
          fee: result[3][0],
          tickSpacing: result[4][0],
          maxLiquidityPerTick: ethers.BigNumber.from(result[5][0].hex),
        };
        this.Immutables = immutables;
        this.fee = this.Immutables!.fee;

        const PoolState: State = {
          liquidity: ethers.BigNumber.from(result[6][0].hex),
          sqrtPriceX96: ethers.BigNumber.from(result[7][0].hex),
          tick: result[7][1],
          observationIndex: result[7][2],
          observationCardinality: result[7][3],
          observationCardinalityNext: result[7][4],
          feeProtocol: result[7][5],
          unlocked: result[7][6],
        };

        this.State = PoolState;

        const token_result = await getPoolErc20AndBalance(
          this.Immutables!.token0,
          this.Immutables!.token1,
          this.address,
          this.provider
        );

        this.token0 = token_result!.token0.token;
        this.token1 = token_result!.token1.token;
        this.balance = {
          token0: token_result!.token0.balance,
          token1: token_result!.token1.balance,
        };
      } catch (err: any) {
        console.log(`Init Pool Multicall error | Pool: ${this.address} | Reason: ${err.reason}`);
      }
    }
    if (this.poolType === "uniswapV2") {
      const contractCallContext: ContractCallContext[] = [{
        reference: "lpPoolContract",
        contractAddress: this.address,
        abi: v2_pool_abi,
        calls: [
          {
            reference: "factory",
            methodName: "factory()",
            methodParameters: [],
          },
          {
            reference: "token0",
            methodName: "token0()",
            methodParameters: [],
          },
          {
            reference: "token1",
            methodName: "token1()",
            methodParameters: [],
          },
          {
            reference: "getReserves",
            methodName: "getReserves()",
            methodParameters: [],
          },
        ],
      }];
      
      try {
        const callresult = (await multicall.call(contractCallContext)).results
          .lpPoolContract.callsReturnContext;
        let result = callresult.map((row) => row.returnValues);

        const token_result = await getPoolErc20AndBalance(
          result[1][0],
          result[2][0],
          this.address,
          this.provider
        );
        this.token0 = token_result!.token0.token;
        this.token1 = token_result!.token1.token;
        this.balance = {
          token0: token_result!.token0.balance,
          token1: token_result!.token1.balance,
        };
        this.v2 = {
          reserve0: ethers.BigNumber.from(result[3][0].hex),
          reserve1: ethers.BigNumber.from(result[3][1].hex),
          timestamp: result[3][2],
        };
      } catch (err: any) {
        console.log(`Init Pool Multicall error | Pool: ${this.address} | Reason: ${err.reason}`);
      }
    }
  }

  async updateReservesV2() {
    if (this.token0?.decimals === 0 || this.token0?.decimals === 0) {
      this.v2 = { reserve0: "0", reserve1: "0", timestamp: 0 };
      return this.v2;
    }
    const result = await this.contract.getReserves();
    this.v2 = {
      reserve0: result.reserve0.toString(),
      reserve1: result.reserve1.toString(),
      timestamp: result.blockTimestampLast,
    };

    // Update DB
    // const update_query = `UPDATE lp_pool SET reserve0 = '${this.v2.reserve0}',reserve1 = '${this.v2.reserve1}',reserve_timestamp=${this.v2.timestamp} WHERE address = '${this.address}'`;
    // await query_db(update_query);

    return this.v2;
  }

  async getSpotPrice(baseCurrency?: string, feeAdjusted: boolean = false) {
    const { lp_pool, poolparam } = await this.unpackPoolParam();
    let baseToken: Token, exchangeToken: Token;

    if (baseCurrency) {
      if (this.token0!.address === baseCurrency) {
        baseToken = this.token0!;
        exchangeToken = this.token1!;
      } else {
        baseToken = this.token1!;
        exchangeToken = this.token0!;
      }
    } else {
      if (this.token0!.address === address.token.weth) {
        baseToken = this.token0!;
        exchangeToken = this.token1!;
      } else if (this.token1!.address === address.token.weth) {
        baseToken = this.token1!;
        exchangeToken = this.token0!;
      } else {
        baseToken = this.token0!;
        exchangeToken = this.token1!;
      }
    }
    const param = [
      pythonRouterPath,
      "getSpotPrice",
      JSON.stringify(poolparam),
      baseToken.address,
      feeAdjusted ? "true" : "false",
    ];

    const result: any = await new Promise(function (resolve, reject) {
      run_python(async (data) => resolve(data), param);
    });
    if (result.status == 0) {
      let datastr = result.data;
      datastr = JSON.parse(datastr);
      this.rate = {
        price: Number(datastr[0]),
        ratio: Number(datastr[1]),
        from: baseToken,
        to: exchangeToken,
      };
      return this.rate;
    } else {
      return result;
    }
  }

  async swapAmountQuote(
    Amount: string | number,
    TokenAddress: string,
    is_input: boolean,
    is_int: boolean = true
  ) {
    let input: swapAmount, output: swapAmount;
    type swapAmount = {
      amount: string;
      amountInt: string;
      symbol?: string;
      tokenAddress?: string;
    };
    Amount = Amount.toString();

    if (this.poolType === "uniswapV3") {
      const quoterContract = new ethers.Contract(
        address.dex.uniswap.v3.quoter,
        QuoterABI,
        this.provider
      );

      let tokenIn: Token, tokenOut: Token;

      if (is_input) {
        if (TokenAddress === this.Immutables?.token0) {
          tokenIn = await getErc20(this.Immutables?.token0);
          tokenOut = await getErc20(this.Immutables?.token1);
        } else if (TokenAddress === this.Immutables?.token1) {
          tokenIn = await getErc20(this.Immutables?.token1);
          tokenOut = await getErc20(this.Immutables?.token0);
        } else {
          throw "Wrong input token address";
        }

        let amountInint, amountIn;
        if (is_int) {
          amountInint = Amount.toString();
          amountIn = ethers.utils.formatUnits(
            Amount.toString(),
            tokenIn.decimals
          );
        } else {
          amountInint = ethers.utils.parseUnits(
            Amount.toString(),
            tokenIn.decimals
          );
          amountIn = Amount.toString();
        }
        let amountOutint;
        try {
          amountOutint = await quoterContract.callStatic.quoteExactInputSingle(
            tokenIn.address,
            tokenOut.address,
            this.Immutables.fee,
            amountInint,
            0
          );
        } catch (err) {
          // console.log(`quoteExactInputSingle err`)
          amountOutint = 0;
        }

        const amountOut = ethers.utils.formatUnits(
          amountOutint,
          tokenOut.decimals
        );

        input = {
          amount: amountIn,
          amountInt: amountInint.toString(),
          tokenAddress: tokenIn.address,
          symbol: tokenIn.symbol,
        };
        output = {
          amount: amountOut,
          amountInt: amountOutint.toString(),
          tokenAddress: tokenOut.address,
          symbol: tokenOut.symbol,
        };
        return { input, output };
      } else {
        if (TokenAddress === this.Immutables?.token0) {
          tokenIn = await getErc20(this.Immutables?.token1);
          tokenOut = await getErc20(this.Immutables?.token0);
        } else if (TokenAddress === this.Immutables?.token1) {
          tokenIn = await getErc20(this.Immutables?.token0);
          tokenOut = await getErc20(this.Immutables?.token1);
        } else {
          throw "Wrong output token address";
        }

        let amountOutint, amountOut;
        if (is_int) {
          amountOutint = Amount.toString();
          amountOut = ethers.utils.formatUnits(
            Amount.toString(),
            tokenOut.decimals
          );
        } else {
          amountOutint = ethers.utils.parseUnits(
            Amount.toString(),
            tokenOut.decimals
          );
          amountOut = Amount.toString();
        }
        let amountInint;
        try {
          amountInint = await quoterContract.callStatic.quoteExactOutputSingle(
            tokenIn.address,
            tokenOut.address,
            this.Immutables.fee,
            amountOutint,
            0
          );
        } catch (err) {
          // console.log(`quoteExactOutputSingle err`)
          amountInint = 0;
        }

        const amountIn = ethers.utils.formatUnits(
          amountInint,
          tokenIn.decimals
        );

        const input = {
          amount: amountIn,
          amountInt: amountInint.toString(),
          tokenAddress: tokenIn.address,
          symbol: tokenIn.symbol,
        };
        const output = {
          amount: amountOut,
          amountInt: amountOutint.toString(),
          tokenAddress: tokenOut.address,
          symbol: tokenOut.symbol,
        };
        return { input, output };
      }
    }

    if (this.poolType === "uniswapV2") {
      await this.updateReservesV2();
      function getAmountOut(
        reserve_token0: string,
        reserve_token1: string,
        token_in_quantity: string,
        token_in: string
      ) {
        const reserves_token0b = ethers.BigNumber.from(reserve_token0);
        const reserves_token1b = ethers.BigNumber.from(reserve_token1);
        const token_in_quantityb = ethers.BigNumber.from(
          token_in_quantity.toString()
        );

        if (token_in === "token0") {
          if (token_in_quantityb.gte(reserves_token0b)) {
            return "0";
          }
          const numerator = reserves_token1b.mul(token_in_quantityb).mul(997);
          const denominator = reserves_token0b
            .mul(1000)
            .add(token_in_quantityb.mul(997));
          const result = numerator.div(denominator).sub(1).toString();
          return result;
        }
        if (token_in === "token1") {
          if (token_in_quantityb.gte(reserves_token1b)) {
            return "0";
          }
          const numerator = reserves_token0b.mul(token_in_quantityb).mul(997);
          const denominator = reserves_token1b
            .mul(1000)
            .add(token_in_quantityb.mul(997));
          const result = numerator.div(denominator).sub(1).toString();
          return result;
        }
      }

      function getAmountIn(
        reserve_token0: string,
        reserve_token1: string,
        token_out_quantity: string,
        token_out: string
      ) {
        const reserves_token0b = ethers.BigNumber.from(reserve_token0);
        const reserves_token1b = ethers.BigNumber.from(reserve_token1);
        const token_out_quantityb = ethers.BigNumber.from(
          token_out_quantity.toString()
        );

        if (token_out === "token0") {
          const numerator = reserves_token1b.mul(token_out_quantityb).mul(1000);
          const denominator = reserves_token0b
            .sub(token_out_quantityb)
            .mul(997);
          const result = numerator.div(denominator).add(1);
          if (result.gte(reserves_token1b)) {
            return "0";
          }
          return result.toString();
        }
        if (token_out === "token1") {
          const numerator = reserves_token0b.mul(token_out_quantityb).mul(1000);
          const denominator = reserves_token1b
            .sub(token_out_quantityb)
            .mul(997);
          const result = numerator.div(denominator).add(1);
          if (result.gte(reserves_token0b)) {
            return "0";
          }
          return result.toString();
        }
      }

      if (
        !(
          TokenAddress === this.token0!.address ||
          TokenAddress === this.token1!.address
        )
      ) {
        return;
      }

      if (is_input === true) {
        let amountInint, amountIn;
        let token_in;
        if (is_int) {
          amountInint = Amount.toString();
          if (TokenAddress === this.token0!.address) {
            token_in = "token0";
            amountIn = ethers.utils.formatUnits(
              Amount.toString(),
              this.token0!.decimals
            );
          } else {
            token_in = "token1";
            amountIn = ethers.utils.formatUnits(
              Amount.toString(),
              this.token1!.decimals
            );
          }
        } else {
          amountIn = Amount.toString();
          if (TokenAddress === this.token0!.address) {
            token_in = "token0";
            amountInint = ethers.utils
              .parseUnits(Amount.toString(), this.token0!.decimals)
              .toString();
          } else {
            token_in = "token1";
            amountInint = ethers.utils
              .parseUnits(Amount.toString(), this.token1!.decimals)
              .toString();
          }
        }

        let amountOutInt = getAmountOut(
          this.v2!.reserve0,
          this.v2!.reserve1,
          amountInint,
          token_in
        );

        const tokenInSymbol =
          token_in === "token0" ? this.token0?.symbol : this.token1?.symbol;
        const tokenOutSymbol =
          token_in === "token0" ? this.token1?.symbol : this.token0?.symbol;
        const tokenOutDecimals =
          token_in === "token0" ? this.token1?.decimals : this.token0?.decimals;
        const tokenInAddress =
          token_in === "token0" ? this.token0?.address : this.token1?.address;
        const tokenOutAddress =
          token_in === "token0" ? this.token1?.address : this.token0?.address;
        input = {
          amount: amountIn,
          amountInt: amountInint,
          symbol: tokenInSymbol,
          tokenAddress: tokenInAddress,
        };
        output = {
          amount: ethers.utils
            .formatUnits(amountOutInt, tokenOutDecimals)
            .toString(),
          amountInt: amountOutInt,
          symbol: tokenOutSymbol,
          tokenAddress: tokenOutAddress,
        };
      } else {
        let amountOutint, amountOut;
        let token_out;
        if (is_int) {
          amountOutint = Amount.toString();
          if (TokenAddress === this.token0!.address) {
            token_out = "token0";
            amountOut = ethers.utils.formatUnits(
              Amount.toString(),
              this.token0!.decimals
            );
          } else {
            token_out = "token1";
            amountOut = ethers.utils.formatUnits(
              Amount.toString(),
              this.token1!.decimals
            );
          }
        } else {
          amountOut = Amount.toString();
          if (TokenAddress === this.token0!.address) {
            token_out = "token0";
            amountOutint = ethers.utils.parseUnits(
              Amount.toString(),
              this.token0!.decimals
            );
          } else {
            token_out = "token1";
            amountOutint = ethers.utils.parseUnits(
              Amount.toString(),
              this.token1!.decimals
            );
          }
        }

        let amountInInt = getAmountIn(
          this.v2!.reserve0,
          this.v2!.reserve1,
          amountOutint,
          token_out
        );

        const tokenOutSymbol =
          token_out === "token0" ? this.token0?.symbol : this.token1?.symbol;
        const tokenInSymbol =
          token_out === "token0" ? this.token1?.symbol : this.token0?.symbol;
        const tokenInDecimals =
          token_out === "token0"
            ? this.token1?.decimals
            : this.token0?.decimals;
        const tokenInAddress =
          token_out === "token0" ? this.token0?.address : this.token1?.address;
        const tokenOutAddress =
          token_out === "token0" ? this.token1?.address : this.token0?.address;

        input = {
          amount: ethers.utils
            .formatUnits(amountInInt, tokenInDecimals)
            .toString(),
          amountInt: amountInInt,
          symbol: tokenInSymbol,
          tokenAddress: tokenInAddress,
        };
        output = {
          amount: amountOut,
          amountInt: amountOutint,
          symbol: tokenOutSymbol,
          tokenAddress: tokenOutAddress,
        };
      }
      return { input, output };
    }
  }

  async swapAmount(
    amount: ethers.BigNumber,
    tokenAddress: string,
    isInput: boolean
  ) {
    let tickDirection;
    if (this.poolType === "uniswapV3") {
      if (isInput) {
        tickDirection =
          tokenAddress === this.token0!.address ? "left" : "right";
      } else {
        tickDirection =
          tokenAddress === this.token0!.address ? "right" : "left";
      }
    }

    const { lp_pool, poolparam } = await this.unpackPoolParam(tickDirection);

    const param = [
      pythonRouterPath,
      "swapAmount",
      amount.toString(),
      tokenAddress,
      isInput,
      JSON.stringify(poolparam),
    ];

    const result: any = await new Promise(function (resolve, reject) {
      run_python(async (data) => resolve(data), param);
    });

    if (result.status == 0) {
      let data = JSON.parse(result.data);
  
      return data[0];
    } else {
      return result;
    }
  }

  async unpackPoolParam(direction?: string) {
    if (!this.initialized) {
      await this.init();
    }

    // Pool params
    let poolparam,
      status = 0;
    const poolAddress = this.address;
    const poolType = this.poolType;
    const token0Address = this.token0!.address;
    const token1Address = this.token1!.address;
    const token0Decimal = this.token0!.decimals;
    const token1Decimal = this.token1!.decimals;
    const token0balance = this.balance!.token0.toString();
    const token1balance = this.balance!.token1.toString();

    if (this.poolType === "uniswapV3") {
      const sqrtPriceX96 = this.State!.sqrtPriceX96.toString();
      const liquidity = this.State!.liquidity.toString();
      const fee = this.Immutables!.fee;
      const currentTick = this.State!.tick;
      const tickSpacing = this.Immutables!.tickSpacing;

      if(!this.v3TickMap){
        const tickMapResult = await this.getTickMapMulti(direction);
        this.v3TickMap = {tickMap:tickMapResult.result,tickMaprange:tickMapResult.range}
      }
      
      const tickMapRange = this.v3TickMap.tickMaprange
      const tickMap = (this.v3TickMap.tickMap).map((row: any) => [
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
        tickMapRange,
        status,
      };
    }

    if (this.poolType === "uniswapV2") {
      const reserve = this.v2!;
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

    return { lp_pool: this, poolparam };
  }

  getPriceFromTick(tick?: number) {
    tick = tick || this.State!.tick;
    if (!Number.isInteger(tick)) throw "tick is not integer";

    if (tick > 0) {
      const decimals_diff = this.token1!.decimals - this.token0!.decimals;
      let raw_price = Math.floor(1.0001 ** tick).toString();

      if (decimals_diff >= 0) {
        return ethers.utils.formatUnits(raw_price, decimals_diff);
      } else {
        return ethers.utils.parseUnits(raw_price, -decimals_diff);
      }
    }

    if (tick < 0) {
      const decimals_diff = this.token0!.decimals - this.token1!.decimals;
      let one_over_raw_price = Math.floor(1.0001 ** -tick).toString();

      if (decimals_diff >= 0) {
        let one_over_price = ethers.utils.formatUnits(
          one_over_raw_price,
          decimals_diff
        );
        return (1 / one_over_price).toString();
      } else {
        let one_over_price = ethers.utils.parseUnits(
          one_over_raw_price,
          -decimals_diff
        );
        return (1 / one_over_price).toString();
      }
    }
  }

  getTickMapPosition(tick: number) {
    const mapPos = Math.floor(tick / this.Immutables!.tickSpacing);
    const wordPos = mapPos >> 8;
    const bitPos = mapPos % 256;
    return { wordPos, bitPos, mapPos };
  }

  async getTickMap() {
    const tick = this.State!.tick;

    const position = this.getTickMapPosition(tick);
    const ticklens_contract = new ethers.Contract(
      address.dex.uniswap.v3.ticklens,
      TickLensABI,
      this.provider
    );

    let result = await ticklens_contract.getPopulatedTicksInWord(
      this.address,
      position.wordPos
    );

    return result;
  }

  async getTickMapMulti(direction?: string, wordNum: number = 5) {
    const tick = this.State!.tick;
    const tickSign = tick>0?1:-1
    let tickMapSafeRange
    const position = this.getTickMapPosition(tick);
    
    const multicall = new Multicall({
      ethersProvider: this.provider,
      tryAggregate: true,
    });

    const contractCallContext: ContractCallContext = {
      reference: "ticklens",
      contractAddress: address.dex.uniswap.v3.ticklens,
      abi: TickLensABI,
      calls: [],
    };

    if (!direction && direction !== "left" && direction !== "right") {
      tickMapSafeRange = [tick-256*(wordNum-1)*this.Immutables!.tickSpacing,tick+256*(wordNum-1)*this.Immutables!.tickSpacing]

      for (let i = 1 - wordNum; i < wordNum; i++) {
        contractCallContext.calls.push({
          reference: "getPopulatedTicksInWord",
          methodName: "getPopulatedTicksInWord(address,int16)",
          methodParameters: [this.address, position.wordPos + i],
        });
      }
    } else {
      let factor;
      if (direction === "left") {
        tickMapSafeRange = [tick-256*(wordNum-1)*this.Immutables!.tickSpacing,tick+1*tickSign]
        factor = -1;
      } else {
        tickMapSafeRange = [tick-1*tickSign,tick+256*(wordNum-1)*this.Immutables!.tickSpacing]
        factor = 1;
      }
      for (let i = 0; i < wordNum; i++) {
        contractCallContext.calls.push({
          reference: "getPopulatedTicksInWord",
          methodName: "getPopulatedTicksInWord(address,int16)",
          methodParameters: [this.address, position.wordPos + factor * i],
        });
      }
    }

    try {
      let callresult = (await multicall.call(contractCallContext)).results
        .ticklens.callsReturnContext;
      let result = callresult.map((res) => res.returnValues);
      result = result.flat().sort((a, b) => b[0] - a[0]);
      let tickMapBound

      if(result.length>0){
        tickMapBound = [ result.slice(-1)[0][0],result[0][0] ]
        tickMapSafeRange = [Math.min(tickMapBound[0],tickMapSafeRange[0]),Math.max(tickMapBound[1],tickMapSafeRange[1])]
      }

      return {result,range:tickMapSafeRange};
    } catch (err: any) {
      console.log(`TickMap Multicall error: ${err.reason}`);
      return {result:[],range:[]}
    }
  }

  async getNextTick(tickMap: any, currentTick: number, toLeft: boolean) {
    const ticklens_contract = new ethers.Contract(
      address.dex.uniswap.v3.ticklens,
      TickLensABI,
      this.provider
    );
    let position = this.getTickMapPosition(currentTick);

    if (tickMap.length < 2) {
      tickMap = await ticklens_contract.getPopulatedTicksInWord(
        this.address,
        position.wordPos
      );
    }

    let check_tickMap = tickMap.map((row: { tick: any }) => row.tick);

    let upperBound = check_tickMap[0];
    let lowerBound = check_tickMap[check_tickMap.length - 1];
    // Check if the provided tickmap range is valid (includes the current tick)
    if (!(currentTick > lowerBound && currentTick < upperBound)) {
      tickMap = await ticklens_contract.getPopulatedTicksInWord(
        this.address,
        position.wordPos
      );
    }

    // If current tick is positive
    if (currentTick > 0 || currentTick < 0) {
      if (toLeft) {
        // Find all ticks below current tick
        let tickMap_new = tickMap.filter(
          (row: { tick: number }) => row.tick < currentTick
        );
        if (tickMap_new.length === 0) {
          tickMap_new = await ticklens_contract.getPopulatedTicksInWord(
            this.address,
            position.wordPos - 1
          );
        }

        // The next tick
        return tickMap_new[0];
      }

      if (!toLeft) {
        // Find all ticks above current tick
        let tickMap_new = tickMap.filter(
          (row: { tick: number }) => row.tick > currentTick
        );
        if (tickMap_new.length === 0) {
          tickMap_new = await ticklens_contract.getPopulatedTicksInWord(
            this.address,
            position.wordPos + 1
          );
        }

        // The next tick
        return tickMap_new[tickMap_new.length - 1];
      }
    }
  }

  async calc_swap(Amount: number, tokenAddress: string, isInput: boolean) {
    type SwapState = {
      amountSpecifiedRemaining: ethers.BigNumber;
      amountCalculated: ethers.BigNumber;
      sqrtPriceX96: number;
      tick: number;
      liquidity: ethers.BigNumber;
    };

    let toLeft: boolean;
    let state: SwapState;
    let tokenIn: Token, tokenOut: Token;
    const startTick = this.State!.tick;
    const tickMap = await this.getTickMap();

    // Starting state
    state = {
      amountSpecifiedRemaining: ethers.BigNumber.from(Amount.toString()),
      amountCalculated: ethers.BigNumber.from(0),
      sqrtPriceX96: this.State!.sqrtPriceX96,
      tick: this.State!.tick,
      liquidity: this.State!.liquidity,
    };

    let sqrtPriceStartX96: ethers.BigNumber, sqrtPriceNextX96: ethers.BigNumber;
    let nextTick: { tick: number; liquidityNet: ethers.BigNumber },
      computeAmounts,
      amountIn: ethers.BigNumber,
      amountOut: ethers.BigNumber;

    if (isInput) {
      if (tokenAddress === this.token0!.address) {
        toLeft = true;
        tokenIn = await getErc20(this.Immutables!.token0);
        tokenOut = await getErc20(this.Immutables!.token1);
      } else if (tokenAddress === this.token1!.address) {
        toLeft = false;
        tokenIn = await getErc20(this.Immutables!.token1);
        tokenOut = await getErc20(this.Immutables!.token0);
      } else throw "Input token not in LP pool";

      while (state.amountSpecifiedRemaining > 0) {
        // Calculate token needed to reach next tick
        sqrtPriceStartX96 = state.sqrtPriceX96;
        nextTick = await this.getNextTick(tickMap, state.tick, toLeft);
        sqrtPriceNextX96 = await getSqrtRatioX96FromTick(nextTick.tick);

        computeAmounts = await computeSwapStep(
          state.liquidity,
          sqrtPriceStartX96,
          sqrtPriceNextX96,
          state.amountSpecifiedRemaining,
          isInput,
          this.Immutables!.fee
        );
        amountIn = ethers.BigNumber.from(computeAmounts!.amountIn).add(
          ethers.BigNumber.from(computeAmounts!.feeAmount)
        );
        amountOut = ethers.BigNumber.from(computeAmounts!.amountOut);

        // Update State
        state.sqrtPriceX96 = sqrtPriceNextX96;
        state.tick = nextTick.tick;
        state.amountSpecifiedRemaining =
          state.amountSpecifiedRemaining.sub(amountIn);
        state.amountCalculated = state.amountCalculated.add(amountOut);

        // Adjust the sqrtPrice and tick if the sqrtPrice do not reach the next tick
        if (toLeft) {
          state.liquidity = state.liquidity.sub(nextTick.liquidityNet);

          if (sqrtPriceNextX96.lt(computeAmounts!.sqrtRatioNextX96)) {
            state.sqrtPriceX96 = computeAmounts!.sqrtRatioNextX96;
            state.tick = await getTickFromSqrtRatioX96(state.sqrtPriceX96);
          }
        } else {
          state.liquidity = state.liquidity.add(nextTick.liquidityNet);
          if (sqrtPriceNextX96.gt(computeAmounts!.sqrtRatioNextX96)) {
            state.sqrtPriceX96 = computeAmounts!.sqrtRatioNextX96;
            state.tick = await getTickFromSqrtRatioX96(state.sqrtPriceX96);
          }
        }
      }
    } else {
      if (tokenAddress === this.token0!.address) {
        toLeft = false;
        tokenIn = await getErc20(this.Immutables!.token1);
        tokenOut = await getErc20(this.Immutables!.token0);
      } else if (tokenAddress === this.token1!.address) {
        toLeft = true;
        tokenIn = await getErc20(this.Immutables!.token0);
        tokenOut = await getErc20(this.Immutables!.token1);
      } else throw "Input token not in LP pool";

      while (state.amountSpecifiedRemaining > 0) {
        // Calculate token needed to reach next tick
        sqrtPriceStartX96 = state.sqrtPriceX96;
        nextTick = await this.getNextTick(tickMap, state.tick, toLeft);
        sqrtPriceNextX96 = await getSqrtRatioX96FromTick(nextTick.tick);

        computeAmounts = await computeSwapStep(
          state.liquidity,
          sqrtPriceStartX96,
          sqrtPriceNextX96,
          state.amountSpecifiedRemaining,
          isInput,
          this.Immutables!.fee
        );
        amountIn = ethers.BigNumber.from(computeAmounts!.amountIn).add(
          ethers.BigNumber.from(computeAmounts!.feeAmount)
        );
        amountOut = ethers.BigNumber.from(computeAmounts!.amountOut);

        // Update State
        state.sqrtPriceX96 = sqrtPriceNextX96;
        state.tick = nextTick.tick;

        state.amountSpecifiedRemaining =
          state.amountSpecifiedRemaining.sub(amountOut);
        state.amountCalculated = state.amountCalculated.add(amountIn);

        // Adjust the sqrtPrice and tick if the sqrtPrice do not reach the next tick
        if (toLeft) {
          state.liquidity = state.liquidity.sub(nextTick.liquidityNet);

          if (sqrtPriceNextX96.lt(computeAmounts!.sqrtRatioNextX96)) {
            state.sqrtPriceX96 = computeAmounts!.sqrtRatioNextX96;
            state.tick = await getTickFromSqrtRatioX96(state.sqrtPriceX96);
          }
        } else {
          state.liquidity = state.liquidity.add(nextTick.liquidityNet);
          if (sqrtPriceNextX96.gt(computeAmounts!.sqrtRatioNextX96)) {
            state.sqrtPriceX96 = computeAmounts!.sqrtRatioNextX96;
            state.tick = await getTickFromSqrtRatioX96(state.sqrtPriceX96);
          }
        }
      }
    }

    const endTick = state.tick;
    const tick = { start: startTick, end: endTick };

    type token = {
      amount: string;
      amountInt: ethers.BigNumber;
      tokenAddress: string;
      symbol: any;
    };
    let input: token, output: token;

    if (isInput) {
      input = {
        amount: ethers.utils.formatUnits(Amount.toString(), tokenIn.decimals),
        amountInt: Amount.toString(),
        tokenAddress: tokenIn.address,
        symbol: tokenIn.symbol,
      };
      output = {
        amount: ethers.utils.formatUnits(
          state.amountCalculated.toString(),
          tokenOut.decimals
        ),
        amountInt: state.amountCalculated.toString(),
        tokenAddress: tokenOut.address,
        symbol: tokenOut.symbol,
      };
    } else {
      input = {
        amount: ethers.utils.formatUnits(
          state.amountCalculated.toString(),
          tokenIn.decimals
        ),
        amountInt: state.amountCalculated.toString(),
        tokenAddress: tokenIn.address,
        symbol: tokenIn.symbol,
      };
      output = {
        amount: ethers.utils.formatUnits(Amount.toString(), tokenOut.decimals),
        amountInt: Amount.toString(),
        tokenAddress: tokenOut.address,
        symbol: tokenOut.symbol,
      };
    }

    return { input, output, tick };
  }

  async getNextSqrtPrice(
    liquidity: ethers.BigNumber,
    sqrtPX96: ethers.BigNumber,
    amount: ethers.BigNumber | number,
    inputTokenAddress: string,
    isInput: boolean
  ) {
    let result: any;
    if (
      inputTokenAddress !== this.token0!.address &&
      inputTokenAddress !== this.token1!.address
    )
      throw "input token not found in LP";
    const isToken0 = inputTokenAddress === this.token0!.address ? 1 : 0;

    if (isInput) {
      const param = [
        pythonRouterPath,
        "getNextSqrtPriceFromInput",
        sqrtPX96,
        liquidity,
        amount,
        isToken0,
      ];

      result = await new Promise(function (resolve, reject) {
        call_python(async (data) => resolve(data), param);
      });
    } else {
      const param = [
        pythonRouterPath,
        "getNextSqrtPriceFromOutput",
        sqrtPX96,
        liquidity,
        amount,
        !isToken0,
      ];

      result = await new Promise(function (resolve, reject) {
        call_python(async (data) => resolve(data), param);
      });
    }

    if (result.status === 0) {
      return result.data;
    } else {
      console.log(result);
      return;
    }
  }

  // Checking if the pool exist in DB, add pool to DB if not exist
  async checkDB() {
    const result = (
      await query_db(
        `SELECT address FROM lp_pool WHERE address='${this.address}';`
      )
    ).rows;
    if (result.length == 0) {
      let insert_string;
      if (this.poolType === "uniswapV3") {
        insert_string = `INSERT INTO lp_pool(address,network,dex_name,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${
          this.address
        }','${this.network}','uniswap_v3','${this.token0!.address}','${
          this.token1!.address
        }','${address.dex.uniswap.v3.router}',${
          this.Immutables!.fee / 1000000
        },'uniswapV3') ON CONFLICT DO NOTHING;`;

        await query_db(insert_string);
        console.log(`New V3 LP Pool Found: ${this.address} | Added to DB`);
      }
    }
  }

  async checkBlackList(){
    if (this.error) return true
    // Check if pool tokens in blacklist
    
    const queryResult = (await query_db(`SELECT address,blacklist from erc20_contract WHERE address IN ('${this.token0!.address}','${this.token1!.address}')`)).rows
    const blacklistResult = (queryResult.map(e=>e.blacklist)).includes(true)
    
    if (blacklistResult){
      return true
    }else{
      return false
    }
      
  }

  checkBaseToken(){
    if (this.error) return false
    const tokenOrder = baseToken.baseTokenOrder

    const searchBaseToken = () => {
      const searchForList = [this.token0!.address,this.token1!.address]
      const searchResult = searchForList.filter((e,i,a)=>(tokenOrder.map(e=>e.address)).includes(e));
      return searchResult.sort((a, b) => {return (tokenOrder.filter(e=>e.address===a)[0]).priority - (tokenOrder.filter(e=>e.address===b)[0]).priority});
    }
    
    // Get base token if exist
    return searchBaseToken().length>0?true:false;
  }

  async checkLiqCriteria() {
    if (this.error) return [false,false,false]

    const baseTokenOrder = baseToken.baseTokenOrder
    const stableCoinList = baseToken.stableCoinList
    const threshold = {weth:{low:0.3,medium:5,high:100},usd:{low:300,medium:6000,high:120000}}

    const searchBaseToken = () => {
      const searchForList = [this.token0!.address,this.token1!.address]
      const searchResult = searchForList.filter((e,i,a)=>(baseTokenOrder.map(e=>e.address)).includes(e));
      return searchResult.sort((a, b) => {return (baseTokenOrder.filter(e=>e.address===a)[0]).priority - (baseTokenOrder.filter(e=>e.address===b)[0]).priority});
    }
    
    // Get base token if exist
    const base_token = searchBaseToken();
  
    // Fail if no base token exist
    if (base_token.length === 0) {
      return [false,false,false];
    }
  
    // check pool liquidity with base token
    let baseTokenReserve;
    if (base_token[0]===this.token0!.address){
      baseTokenReserve = ethers.utils.formatUnits(this.balance?.token0,this.token0!.decimals)
    }else{
      baseTokenReserve = ethers.utils.formatUnits(this.balance?.token1,this.token1!.decimals)
    }

    // test liquidity criteria
    if (base_token[0] === address.token.weth) {
      const ethPrice = await getEthPriceInUSD()
      
      const testlow = baseTokenReserve>threshold.weth.low?true:false
      const testmedium = baseTokenReserve>threshold.weth.medium?true:false
      const testhigh = baseTokenReserve>threshold.weth.high?true:false
      const baseValueLockedUSD = Math.floor(ethPrice*baseTokenReserve)
      
      return [testlow,testmedium,testhigh,baseValueLockedUSD]
      
    } else if (stableCoinList.includes(base_token[0])){
      const testlow = baseTokenReserve>threshold.usd.low?true:false
      const testmedium = baseTokenReserve>threshold.usd.medium?true:false
      const testhigh = baseTokenReserve>threshold.usd.high?true:false
      const baseValueLockedUSD = Math.floor(baseTokenReserve)
      return [testlow,testmedium,testhigh,baseValueLockedUSD]
    }else{
      return [false,false,false]
    }

  }
  
}

export class LpPools {
  pools: LpPool[];
  poolsList: string[];
  network: string;
  initialized?: boolean;
  error:boolean=false;

  constructor(param: { pools: string[]; network?: string }) {
    this.poolsList = param.pools;
    this.pools = param.pools.map((pool) => {
      return new LpPool({ address: pool });
    });

    this.network = param.network || "ethereum";
    this.initialized = false;
  }

  async init() {
    this.pools = await Promise.all(
      this.pools.map(async (pool) => {
        await pool.init();
        return pool;
      })
    );
    // this.error = (this.pools).map(pool=>pool.error).includes(true)
    this.initialized = true;
  }

  async swapAmount(
    amount: ethers.BigNumber,
    FirstToken: string,
    isInput: boolean,
    PoolPath: string[]
  ) {
    // if(this.error) return 0
    
    for (const poolAddress of PoolPath) {
      if (!this.poolsList.includes(poolAddress)) {
        throw "Pool Path Wrong Input";
      }
    }

    let poolParams = (await this.unpackMultiPoolParams(PoolPath)).map(pool=>pool.poolparam)
    // console.log(poolParams)
    const param = [
      pythonRouterPath,
      "swapAmountMultiHop",
      amount.toString(),
      FirstToken,
      isInput,
      JSON.stringify(poolParams),
    ];

    const result: any = await new Promise(function (resolve, reject) {
      run_python(async (data) => resolve(data), param);
    });

    if (result.status == 0) {
      let data = JSON.parse(result.data);
      return data[0];
    } else {
      return result;
    }
  }

  async calcProfitMultiHop(
    borrowAmount: ethers.BigNumber,
    borrowAddress: string,
    PoolPath: string[]
  ) {
    // if(this.error) return 0
    
    for (const poolAddress of PoolPath) {
      if (!this.poolsList.includes(poolAddress)) {
        throw "Pool Path Wrong Input";
      }
    }

    let swapPools = PoolPath.map(
      (poolAddress) =>
        this.pools.filter((pool) => pool.address === poolAddress)[0]
    );
    // const firstPool = swapPools.filter(
    //   (pool) => pool.address === PoolPath[0]
    // )[0];
    // const firstToken =
    //   firstPool.token0!.address === borrowAddress
    //     ? firstPool.token1!.address
    //     : firstPool.token0!.address;

    let poolParams = (
      await this.unpackMultiPoolParams(PoolPath)
    ).map((e) => e.poolparam);

    const param = [
      pythonRouterPath,
      "calcProfitMultiHop",
      borrowAmount.toString(),
      borrowAddress,
      JSON.stringify(poolParams),
    ];

    const result: any = await new Promise(function (resolve, reject) {
      run_python(async (data) => resolve(data), param);
    });

    if (result.status == 0) {
      // let data = JSON.parse(result.data);
      return result.data;
    } else {
      return result;
    }
  }

  async optimizeMultiHop(PoolPath: string[], borrowAddress: string) {
    // if(this.error) return {
    //   optimal_borrow: '0',
    //   profit: '0',
    //   repayAmount: '0',
    //   swapOutAmount: '0',
    //   pInsqrtPriceX96: '0',
    //   pOutsqrtPriceX96: '0',
    //   tokenBorrow: '',
    //   tokenBase: ''
    // }
    
    for (const poolAddress of PoolPath) {
      if (!this.poolsList.includes(poolAddress)) {
        throw "Pool Path Wrong Input";
      }
    }

    let swapPools = PoolPath.map(
      (poolAddress) =>
        this.pools.filter((pool) => pool.address === poolAddress)[0]
    );
    
    // const firstPool = swapPools.filter(
    //   (pool) => pool.address === PoolPath[0]
    // )[0];
    // const firstToken =
    //   firstPool.token0!.address === borrowAddress
    //     ? firstPool.token1!.address
    //     : firstPool.token0!.address;
    

    let poolParams = (
      await this.unpackMultiPoolParams(PoolPath)
    ).map((e) => e.poolparam);
    
    const param = [
      pythonRouterPath,
      "optimizeMultiHop",
      borrowAddress,
      JSON.stringify(poolParams),
    ];

    const result: any = await new Promise(function (resolve, reject) {
      run_python(async (data) => resolve(data), param);
    });

    if (result.status == 0) {
      let data = JSON.parse(result.data);
      return data;
    } else {
      return result;
    }
  }

  async unpackMultiPoolParams(
    swapPath: string[],
  ) {
    if (!this.initialized) {
      await this.init();
    }

    const swapPathPool = swapPath
      .map((poolAddress) => this.pools.filter((e) => e.address === poolAddress)[0])

    // let tickDirectionMap: { address: string; tickDirection: string }[] = [];
    // if (FirstTokenAddress) {
    //   if (isInput) {
    //     let inputTokenAddress = FirstTokenAddress;

    //     for (let i = 0; i < swapPathPool.length; i++) {

    //       if (swapPathPool[i].token0!.address === inputTokenAddress) {
    //         tickDirectionMap.push({
    //           address: swapPathPool[i].address,
    //           tickDirection: "left",
    //         });
    //         inputTokenAddress = swapPathPool[i].token1!.address;
    //       } else if (swapPathPool[i].token1!.address === inputTokenAddress) {
    //         tickDirectionMap.push({
    //           address: swapPathPool[i].address,
    //           tickDirection: "right",
    //         });
    //         inputTokenAddress = swapPathPool[i].token0!.address;
    //       } else {
    //         console.log(
    //           "unpackMultiPool contain invaild pool path. Check again."
    //         );
    //         tickDirectionMap = [];
    //         break;
    //       }
    //     }
    //   } else {
    //     let outputTokenAddress = FirstTokenAddress;

    //     for (let i = swapPathPool.length - 1; i >= 0; i--) {
    //       if (swapPathPool[i].token0!.address === outputTokenAddress) {
    //         tickDirectionMap.push({
    //           address: swapPathPool[i].address,
    //           tickDirection: "right",
    //         });
    //         outputTokenAddress = swapPathPool[i].token1!.address;
    //       } else if (swapPathPool[i].token1!.address === outputTokenAddress) {
    //         tickDirectionMap.push({
    //           address: swapPathPool[i].address,
    //           tickDirection: "left",
    //         });
    //         outputTokenAddress = swapPathPool[i].token0!.address;
    //       } else {
    //         console.log(
    //           "unpackMultiPool contain invaild pool path. Check again."
    //         );
    //         tickDirectionMap = [];
    //         break;
    //       }
    //     }
    //     tickDirectionMap.reverse();
    //   }
    // }

    const poolParams = await Promise.all(
      swapPathPool.map(async (pool) => {
        const unpack = await pool.unpackPoolParam()
        return unpack;
      })
    );
    
    return poolParams;
  }
}

export async function getLpPoolV3(address: string) {
  const lpPoolobject = new LpPool({ address });
  await lpPoolobject.init();

  let pool: Pool;

  pool = new Pool(
    lpPoolobject.token0!,
    lpPoolobject.token1!,
    lpPoolobject.Immutables!.fee,
    lpPoolobject.State!.sqrtPriceX96.toString(),
    lpPoolobject.State!.sqrtPriceX96.toString(),
    lpPoolobject.State!.tick
  );
  return pool;
}

export async function checkPoolBlackList(){
  const checkQuery = `SELECT address FROM lp_pool WHERE blacklist IS NULL;`
  const pools = ((await query_db(checkQuery)).rows).map(e=>e.address)
  const poolLength = pools.length
  const chunksize = 1000
  const iteration = Math.ceil(pools.length/chunksize)
  
  let counter = 0
  console.log(`Number of pools' blacklist to be updated: ${poolLength}`)

  for (let i=0;i<iteration;i++){
    const chunk = pools.splice(0,chunksize)

    await Promise.all(chunk.map(async e=>{
      const lp_pool = new LpPool({address:e})
      await lp_pool.init()
      const blacklist = await lp_pool.checkBlackList()
      await query_db(`UPDATE lp_pool SET blacklist=${blacklist} WHERE address='${e}';`)
      // console.log(`Pool ${lp_pool.address} updated blacklist = ${blacklist}`)
    }))
    counter+=chunk.length
    console.log(`${counter}/${poolLength} pool blacklist updated`)
  }
}

export async function bulkCheckCriteria(checkRange:string='low_liquidity') {
  let checkQuery,pools
  if (checkRange==='low_liquidity'){
    checkQuery = `SELECT address FROM lp_pool WHERE liquidity_criteria_low=true AND blacklist=false`
  }else if (checkRange==='medium_liquidity') {
    checkQuery = `SELECT address FROM lp_pool WHERE liquidity_criteria_medium=true AND blacklist=false`
  }else{
    checkQuery = ``
  }
  pools = ((await query_db(checkQuery)).rows).map(e=>e.address)

  const poolLength = pools.length
  const chunksize = 1000
  const iteration = Math.ceil(pools.length/chunksize)
  
  let counter = 0
  console.log(`Number of pools' to be checked: ${poolLength}`)

  for (let i=0;i<iteration;i++){
      const startTime = performance.now()
      const chunk = pools.splice(0,chunksize)
      await Promise.all(chunk.map(async e=>{
        const lp_pool = new LpPool({address:e})
        await lp_pool.init()

        if (lp_pool.error){
          const query_string = `UPDATE lp_pool SET init_error=true WHERE address='${e}';`
          await query_db(query_string)
        }else{
          const blacklist = await lp_pool.checkBlackList()
          const hasBaseToken = lp_pool.checkBaseToken()
          const liqCriteria = await lp_pool.checkLiqCriteria()

          const query_string = `UPDATE lp_pool SET blacklist=${blacklist},has_base_token=${hasBaseToken},liquidity_criteria_low=${liqCriteria[0]},liquidity_criteria_medium=${liqCriteria[1]},liquidity_criteria_high=${liqCriteria[2]},base_value_locked_usd=${liqCriteria[3]},init_error=false WHERE address='${e}';`
      
          await query_db(query_string)
        }

      }))
      counter+=chunk.length
      const totalTime = Math.round(performance.now()-startTime)/1000
      console.log(`${counter}/${poolLength} pools updated (${totalTime}s)`)
  }

  
}

export async function addNewPoolsV3(){
  const provider = getProvider()
  const iface = new ethers.utils.Interface([
      "event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)",
    ]);
  
  const topics = [
  ethers.utils.id(
      "PoolCreated(address,address,uint24,int24,address)"
  ),
  ];

  const lastBlock = 15113426
  const endBlock = await provider.getBlockNumber()
  const buffer = 10000

  console.log('Adding V3 pools')
  for (let i=lastBlock;i<endBlock;i=i+buffer){
      const logs = await provider.getLogs({
          // address:address.dex.uniswap.v3.factory,
          topics,
          fromBlock:i,
          toBlock:i+buffer
        })

      if (logs.length>0){
          const decodelog = (logs.map((log: any)=>iface.parseLog(log))).map((e: { args: any; })=>{
              const result = e.args
              return {address:result.pool,token0:result.token0,token1:result.token1,fee:result.fee}
          });
          
          const fetchedAddress = decodelog.map((e: { address: any; })=>"'"+e.address+"'").join(',')
  
          let dbPools = (await query_db(`SELECT address FROM lp_pool WHERE address IN (${fetchedAddress});`)).rows
          if (dbPools.length>0){
              dbPools = dbPools.map(e=>e.address)
          }
          
          let newPools = decodelog.filter((e: { address: any; },i: any,a: any)=>!dbPools.includes(e.address))
          let query_strings = await Promise.all(newPools.map(async(e: any)=>{
            const lp_pool = new ethers.Contract(e.address,v3_pool_abi,provider)
            const factoryAddress = await lp_pool.factory()
            return factoryAddress===address.dex.uniswap.v3.factory?`INSERT INTO lp_pool (address,network,dex_name,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${e.address}','ethereum','uniswap_v3','${e.token0}','${e.token1}','${address.dex.uniswap.v3.router}',${e.fee/1000000},'uniswapV3');`:''}))
            
          query_strings = query_strings.filter(e=>e!=='')

          await query_db(query_strings.join(''))
          console.log(`${query_strings.length} V3 Pools Inserted from block ${i} to ${i+buffer}`)
      }
 
  }
  console.log('V3 pools adding done')
  
}

export async function addNewPoolsV2(){
  const provider = getProvider()
  const v2factoryABI = ["function allPairs(uint) external view returns (address pair)","function allPairsLength() external view returns (uint)"]

  // Uniswap V2
  const unilastPoolNum = (await query_db(`SELECT pool_num FROM lp_pool WHERE dex_name='uniswap_v2' ORDER BY pool_num DESC LIMIT 1`)).rows[0].pool_num
  const univ2factory = new ethers.Contract(address.dex.uniswap.v2.factory,v2factoryABI,provider)
  const unipairLength = await univ2factory.allPairsLength()
  console.log(`Adding uniswap V2 pools starting pool number: ${unilastPoolNum} | ending number: ${unipairLength}`)
  for (let i=unilastPoolNum+1;i<unipairLength;i++){
      const newPair = await univ2factory.allPairs(i)
      const newPool = new LpPool({address:newPair})
      await newPool.init()
      if (newPool.error){
        continue
      }
      const query_string = `INSERT INTO lp_pool (address,network,dex_name,pool_num,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${newPool.address}','ethereum','uniswap_v2',${i},'${newPool.token0!.address}','${newPool.token1!.address}','${address.dex.uniswap.v2.router}',${3000/1000000},'uniswapV2');`
      await query_db(query_string)
      console.log(`Uniswap V2 Pool Inserted | Pool Num: ${i} | Address: ${newPool.address}`)
  }

  // sushi V2
  const sushilastPoolNum = (await query_db(`SELECT pool_num FROM lp_pool WHERE dex_name='sushiswap_v2' ORDER BY pool_num DESC LIMIT 1`)).rows[0].pool_num
  const sushiv2factory = new ethers.Contract(address.dex.sushiswap.factory,v2factoryABI,provider)
  const sushipairLength = await sushiv2factory.allPairsLength()
  console.log(`Adding sushiswap V2 pools starting pool number: ${sushilastPoolNum} | ending number: ${sushipairLength}`)
  for (let i=sushilastPoolNum+1;i<sushipairLength;i++){
      const newPair = await sushiv2factory.allPairs(i)
      const newPool = new LpPool({address:newPair})
      await newPool.init()
      const query_string = `INSERT INTO lp_pool (address,network,dex_name,pool_num,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${newPool.address}','ethereum','sushiswap_v2',${i},'${newPool.token0!.address}','${newPool.token1!.address}','${address.dex.sushiswap.router}',${3000/1000000},'uniswapV2');`
      await query_db(query_string)
      console.log(`Sushiswap V2 Pool Inserted | Pool Num: ${i} | Address: ${newPool.address}`)

  }
}

export async function addNewTokensFromPools(){
  const poolTokens = ((await query_db(`SELECT token0_address,token1_address FROM lp_pool;`)).rows).map(e=>[e.token0_address,e.token1_address]).flat()
  const uniqueTokens = [... new Set(poolTokens)]

  const dbtokens = ((await query_db(`SELECT address FROM erc20_contract;`)).rows).map(e=>e.address)

  const missingTokens = uniqueTokens.filter(e=>!dbtokens.includes(e))
  console.log(`Found ${missingTokens.length} missing tokens, now adding to DB`)
  await Promise.all(missingTokens.map(async e=>{
    const token = new Erc20({address:e})
    await token.init()
  }))
  console.log(`All tokens added`)
  
}

export async function addV2V3PoolsAndCheckCriteria(){
  await addNewPoolsV2()
  await addNewPoolsV3()
  // Find new token from pools token0 and token1 address and add them to token table
  console.log(`Adding new tokens to DB`)
  await addNewTokensFromPools()
  // Check new tokens status and assign to blacklist if contract not verified
  await checkErc20inDB()
  // Check new pools to see if they pass the liquidity test criteria for arbitrage
  await bulkCheckCriteria()
}

export async function filterOutWrongV3(){
  const provider = getProvider()
  const v3poolAddress = ((await query_db(`SELECT address FROM lp_pool WHERE pool_type='uniswapV3'`)).rows).map(e=>e.address)

  const result = await Promise.all(v3poolAddress.map(async e=>{
      const lp_pool = new ethers.Contract(e,v3_pool_abi,provider)
      const factoryAddress = await lp_pool.factory()
      return {address:e,factory:factoryAddress}
  }))
  const extraPool = result.filter(e=>e.factory!==address.dex.uniswap.v3.factory)
  for (const row of extraPool ){
      await query_db(`UPDATE lp_pool SET dex_name='other',pool_type='other' WHERE address='${row.address}';`)
      console.log(`Pool ${row.address} changed to others`)
  }
}