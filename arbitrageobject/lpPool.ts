import { ethers } from "ethers";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
import { address } from "../address";
import {
  call_python,
  computeSwapStep,
  getSqrtRatioX96FromTick,
  getTickFromSqrtRatioX96,
  unpackPoolParam
} from "../helpers";
import { Erc20, getErc20, getErc20Balance } from "./erc20";

import { Token } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import { abi as TickLensABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json";
import { Pool } from "@uniswap/v3-sdk";
const BigNumber = ethers.BigNumber;

const v2_pool_abi = [
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

// UniswapV3 quoter address
const quoterAddressV3 = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
// const provider = getProvider();

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
  provider?: any
  poolType?: "uniswapV2" | "uniswapV3";
  notupdateState?: boolean;
  contract: ethers.Contract;
  Immutables?: Immutables;
  State?: State;
  token0?: Token;
  token1?: Token;
  balance?:{token0:string,token1:string}
  rate?:{price: Number, from:Token,to:Token}
  fee?:Number
  v2?: { reserve0: string; reserve1: string; timestamp: number };

  constructor(param: any) {
    this.address = param.address;
    this.network = param.network || "ethereum";
    this.notupdateState = param.notupdateState;
  }

  async init(provider?:any) {
    if (!provider){
      provider = getProvider();
    }
    this.provider = provider
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

      // Get immutables
      this.Immutables = await this.getPoolImmutables();
      this.token0 = await getErc20(this.Immutables!.token0);
      this.token1 = await getErc20(this.Immutables!.token1);


      // Get current state
      if (!this.notupdateState) {
        this.State = await this.getPoolState();
        this.balance = {token0:await getErc20Balance(this.token0.address,this.address),token1:await getErc20Balance(this.token1.address,this.address)}
      }
    } else {
      this.poolType = "uniswapV2";
      this.contract = new ethers.Contract(this.address, v2_pool_abi, provider);
      this.token0 = await getErc20(await this.contract.token0());
      this.token1 = await getErc20(await this.contract.token1());
      this.balance = {token0:await getErc20Balance(this.token0.address,this.address),token1:await getErc20Balance(this.token1.address,this.address)}
      this.fee = 3000
      // Get current state
      if (!this.notupdateState) {
        // this.v2 = await this.updateReservesV2()
      }
    }
    if (!(this.token0 && this.token1)) {
      console.log(`LP: ${this.address} cannot fetch token`);
    }

    this.notupdateState=false
  }

  async getPoolImmutables() {
    if (this.poolType === "uniswapV3") {
      const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] =
        await Promise.all([
          this.contract.factory(),
          this.contract.token0(),
          this.contract.token1(),
          this.contract.fee(),
          this.contract.tickSpacing(),
          this.contract.maxLiquidityPerTick(),
        ]);

      const immutables: Immutables = {
        factory,
        token0,
        token1,
        fee,
        tickSpacing,
        maxLiquidityPerTick,
      };
      this.fee = this.Immutables?.fee
      return immutables;
    }
  }

  async getPoolState() {
    if (this.poolType === "uniswapV3") {
      const [liquidity, slot] = await Promise.all([
        this.contract.liquidity(),
        this.contract.slot0(),
      ]);

      const PoolState: State = {
        liquidity,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        observationIndex: slot[2],
        observationCardinality: slot[3],
        observationCardinalityNext: slot[4],
        feeProtocol: slot[5],
        unlocked: slot[6],
      };

      return PoolState;
    }

    if (this.poolType === "uniswapV2") {
      console.log(`V2 Pool cannot get state: ${this.address}`);
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
    const update_query = `UPDATE lp_pool SET reserve0 = '${this.v2.reserve0}',reserve1 = '${this.v2.reserve1}',reserve_timestamp=${this.v2.timestamp} WHERE address = '${this.address}'`;
    await query_db(update_query);

    return this.v2;
  }

  async getSpotPrice() {
    const {lp_pool,poolparam} = await unpackPoolParam(this)
    let baseToken:Token,exchangeToken:Token
    
    if(this.token0!.address===address.token.weth){
      baseToken = this.token0!
      exchangeToken = this.token1!
    }else if(this.token1!.address===address.token.weth){
      baseToken = this.token1!
      exchangeToken = this.token0!
    }else {
      baseToken = this.token0!
      exchangeToken = this.token1!
    }
  
    const param = [
      "../../univ3py/univ3py_main/router.py",
      "getSpotPrice",
      JSON.stringify(poolparam),
      baseToken.address,
    ];
  
    const result: any = await new Promise(function (resolve, reject) {
      call_python(async (data) => resolve(data), param, "custom");
    });
    if (result.status==0){
      let datastr = result.data;
      datastr = datastr.replace(/\s/g, "");
      this.rate = {price: Number(datastr), from:baseToken,to:exchangeToken}
      return this.rate;
    }else{
      return result
    }
  }

  async swapAmount(
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
        quoterAddressV3,
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
        let amountOutint
        try {
          amountOutint =
          await quoterContract.callStatic.quoteExactInputSingle(
            tokenIn.address,
            tokenOut.address,
            this.Immutables.fee,
            amountInint,
            0
          );
        }catch(err){
          // console.log(`quoteExactInputSingle err`)
          amountOutint = 0
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
        let amountInint
        try{
          amountInint =
          await quoterContract.callStatic.quoteExactOutputSingle(
            tokenIn.address,
            tokenOut.address,
            this.Immutables.fee,
            amountOutint,
            0
          );
        }catch(err){
          // console.log(`quoteExactOutputSingle err`)
          amountInint = 0
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

  async getTickMap(tick?: number,wordNum:number=1,isLeft?:boolean) {
    if (!tick) {
      tick = this.State!.tick;
    }
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

    if(wordNum>1){
      
      let new_wordPos
      for (let i=0;i<wordNum;i++){
        if(isLeft===true){
          new_wordPos = position.wordPos - (1+i)
        }else if (isLeft===false){
          new_wordPos = position.wordPos + (1+i)
        }else{
          return result
        }
        let new_result = await ticklens_contract.getPopulatedTicksInWord(
          this.address,
          new_wordPos
        );
        result = result.concat(new_result)
        result = result.sort((a: { tick: number; },b: { tick: number; })=>b.tick-a.tick)
      }
    }

    return result
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
        "../../univ3py/univ3py_main/router.py",
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
        "../../univ3py/univ3py_main/router.py",
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
}

export async function getLpPoolV3(address: string) {
  const lpPoolobject = new LpPool({ address });
  await lpPoolobject.init();

  let pool: Pool;
  if (
    lpPoolobject.token0 &&
    lpPoolobject.token1 &&
    lpPoolobject.Immutables?.fee &&
    lpPoolobject.State?.tick
  ) {
    pool = new Pool(
      lpPoolobject.token0,
      lpPoolobject.token1,
      lpPoolobject.Immutables?.fee,
      lpPoolobject.State?.sqrtPriceX96.toString(),
      lpPoolobject.State?.sqrtPriceX96.toString(),
      lpPoolobject.State?.tick
    );
    return pool;
  }

  return;
}
