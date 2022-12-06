import { Token } from "@uniswap/sdk-core";
import axios from "axios";
// import rateLimit from 'axios-rate-limit';
import {
  ContractCallContext,
  ContractCallResults,
  Multicall
} from "ethereum-multicall";
import { ethers } from "ethers";
import { etherscanAPI, getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
const providerErc20 = getProvider();

export const erc20_abi = [
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "event Transfer(address from, address to, uint256 value)",
  "event Approval(address owner, address spender, uint256 value)",
  "function name() external view returns (string memory)",
  "function symbol() external view returns (string memory)",
  "function decimals() external view returns (uint8)",
  "function implementation() external view returns (address)",
];

export class Erc20 {
  address: string;
  network: string;
  decimals: number;
  symbol?: string;
  name?: string;
  contract: ethers.Contract;

  constructor(param: any) {
    this.address = param.address;
    this.network = param.network || "ethereum";
    this.decimals = param.decimals || 0;
    this.contract = new ethers.Contract(
      param.address,
      erc20_abi,
      providerErc20
    );
  }

  async init() {
    const fetchFromBlockchain = async () => {
      try {
        this.decimals = await this.contract.decimals();
      } catch (err) {
        this.decimals = 0;
        console.log(`Cannot fetch token decimals: ${this.address}`);
      }

      try {
        this.symbol = String(await this.contract.symbol());
        this.name = String(await this.contract.name());
      } catch (err) {
        try {
          this.contract = await ethers.getVerifiedContractAt(this.address);
          this.symbol = String(await this.contract.symbol());
          this.name = String(await this.contract.name());
          // console.log(`Fetched latest contract of this erc20: ${this.address}`)
        } catch (err) {
          this.symbol = "";
          this.name = "";
          // console.log(`Cannot fetch name/symbol of this erc20: ${this.address}`)
        }
      }

      try {
        await query_db(
          `INSERT INTO erc20_contract(address,network,symbol,decimals,name) VALUES ('${this.address}','${this.network}','${this.symbol}',${this.decimals},'${this.name}') `
        );
      } catch (err: any) {
        try {
          await query_db(
            `INSERT INTO erc20_contract(address,network,symbol,decimals,name) VALUES ('${this.address}','${this.network}','',${this.decimals},'') `
          );
        } catch (err: any) {
          console.log(`New erc20 db insert error: ${err.code}`);
        }
      }
    };

    const fetchFromDB = async () => {
      const { symbol, decimals, name } = (
        await query_db(
          `SELECT symbol,decimals,name FROM erc20_contract WHERE address='${this.address}'`
        )
      ).rows[0];
      this.symbol = symbol;
      this.decimals = decimals;
      this.name = name;
    };

    try {
      await fetchFromDB();
    } catch (err) {
      await fetchFromBlockchain();
    }
  }

  async check_balance(address: string) {
    if (this.decimals) {
      const balance = await this.contract.balanceOf(address);
      return balance;
    } else {
      return;
    }
  }
}

export async function getErc20(address: string) {
  const erc20object = new Erc20({ address });
  await erc20object.init();
  return new Token(
    1,
    address,
    erc20object.decimals,
    erc20object.symbol,
    erc20object.name
  );
}

export async function getErc20Balance(
  token: string | Erc20,
  balanceAddress: string
) {
  let erc20object: Erc20;
  if (typeof token !== "string") {
    erc20object = token;
    console.log("string provided");
  } else {
    erc20object = new Erc20({ address: token });
    await erc20object.init();
  }

  const balance = await erc20object.check_balance(balanceAddress);
  return balance;
}

export async function getPoolErc20AndBalance(
  token0: string,
  token1: string,
  poolAddress: string,
  provider: any = providerErc20
) {
  const multicall = new Multicall({
    ethersProvider: provider,
    tryAggregate: true,
  });

  const contractCallContext: ContractCallContext[] = [
    {
      reference: "token0",
      contractAddress: token0,
      abi: erc20_abi,
      calls: [
        {
          reference: "decimals",
          methodName: "decimals()",
          methodParameters: [],
        },
        {
          reference: "symbol",
          methodName: "symbol()",
          methodParameters: [],
        },
        {
          reference: "name",
          methodName: "name()",
          methodParameters: [],
        },
        {
          reference: "balanceOf",
          methodName: "balanceOf(address)",
          methodParameters: [poolAddress],
        },
      ],
    },
    {
      reference: "token1",
      contractAddress: token1,
      abi: erc20_abi,
      calls: [
        {
          reference: "decimals",
          methodName: "decimals()",
          methodParameters: [],
        },
        {
          reference: "symbol",
          methodName: "symbol()",
          methodParameters: [],
        },
        {
          reference: "name",
          methodName: "name()",
          methodParameters: [],
        },
        {
          reference: "balanceOf",
          methodName: "balanceOf(address)",
          methodParameters: [poolAddress],
        },
      ],
    },
  ];

  try {
    const callresult = (await multicall.call(contractCallContext)).results;
    

    const t0result = callresult.token0.callsReturnContext.map(
      (row) => row.returnValues[0]
    );
    
    const t1result = callresult.token1.callsReturnContext.map(
      (row) => row.returnValues[0]
    );
    const t0 = new Token(1, token0, t0result[0], t0result[1], t0result[2]);
    const t1 = new Token(1, token1, t1result[0], t1result[1], t1result[2]);

    return {
      token0: { token: t0, balance: ethers.BigNumber.from(t0result[3].hex) },
      token1: { token: t1, balance: ethers.BigNumber.from(t1result[3].hex) },
    };
  } catch (err: any) {
    console.log(
      `Get ERC20 Multicall error | T0: ${token0} | T1: ${token1} | Reason: ${err.reason}`
    );
  }
}

// Check if the token address pass the erc20 test, return true if it fails
export async function checkErc20Error(
  tokenAddress: string,
  provider: any = providerErc20
) {
  const multicall = new Multicall({
    ethersProvider: provider,
    tryAggregate: true,
  });
  const testAddress = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
  const contractCallContext: ContractCallContext[] = [
    {
      reference: "token",
      contractAddress: tokenAddress,
      abi: erc20_abi,
      calls: [
        {
          reference: "decimals",
          methodName: "decimals()",
          methodParameters: [],
        },
        {
          reference: "symbol",
          methodName: "symbol()",
          methodParameters: [],
        },
        {
          reference: "name",
          methodName: "name()",
          methodParameters: [],
        },
        {
          reference: "balanceOf",
          methodName: "balanceOf(address)",
          methodParameters: [testAddress],
        },
      ],
    },
  ];

  // Multicalling token contract
  try {
    const callresult = (await multicall.call(contractCallContext)).results.token
      .callsReturnContext;
    const callerror = callresult.map((e) => e.success).includes(false);
    if (callerror) {
      return { token: tokenAddress, msg: "multicall error", status: 1 };
    }
  } catch (err: any) {
    // console.log(`Get ERC20 Multicall error | Token: ${tokenAddress} | Reason: ${err.reason}`);
    return { token: tokenAddress, msg: "multicall error", status: 1 };
  }

  // Calling etherscan to check verify contract
  try {
    const contractABI = await axios.get(
      `https://api.etherscan.io/api?module=contract&action=getabi&address=${tokenAddress}&apikey=${etherscanAPI}`
    );

    if (contractABI.data.status === "0") {
      return { token: tokenAddress, msg: contractABI.data.result, status: 1 };
    }
  } catch (err) {
    return {
      token: tokenAddress,
      msg: "etherscan contract api error",
      status: 1,
    };
  }

  return { token: tokenAddress, msg: "Normal", status: 0 };
}

export async function checkErc20inDB() {
  const tokenList = (
    await query_db(`SELECT address FROM erc20_contract WHERE blacklist IS NULL`)
  ).rows.map((e) => e.address);
  const tokenListLength = tokenList.length;

  for (const idx in tokenList) {
    try {
      const checkResult = await checkErc20Error(tokenList[idx]);
      if (checkResult.status === 1) {
        if (checkResult.msg === "Contract source code not verified") {
          query_db(
            `UPDATE erc20_contract SET blacklist=true WHERE address='${tokenList[idx]}'`
          );
        }else if (checkResult.msg === "multicall error"){
          query_db(
            `UPDATE erc20_contract SET blacklist=true WHERE address='${tokenList[idx]}'`
          );
        }
      } else {
        query_db(
          `UPDATE erc20_contract SET blacklist=false WHERE address='${tokenList[idx]}'`
        );
      }

      console.log(
        `[${Number(idx) + 1}/${tokenListLength}] Token ${
          tokenList[idx]
        } | Status: ${checkResult.status} | Msg: ${checkResult.msg}`
      );
    } catch (err) {
      console.log(err);
    }
  }
}

export async function findMissingPoolTokens() {
  let poolTokenList = [
    ...new Set(
      (await query_db(`SELECT token0_address,token1_address FROM lp_pool`)).rows
        .map((row) => {
          return [row.token0_address, row.token1_address];
        })
        .flat()
    ),
  ];
  // const queryString = poolTokenList.map(e=>{return "'"+e+"'"}).join(',')
  const DBtokenList = (
    await query_db(`SELECT address FROM erc20_contract;`)
  ).rows.map((e) => e.address);
  const missingTokens = poolTokenList.filter((e) => !DBtokenList.includes(e));
  console.log(
    `${missingTokens.length} missing tokens found, attempt adding to DB.`
  );

  for (const token of missingTokens) {
    const newToken = new Erc20({ address: token });
    await newToken.init();
    console.log(`Token ${token} init`);
  }
}

export async function addTokentoBlackList(tokenAddress:string){
  await query_db(`UPDATE erc20_contract SET blacklist=true WHERE address='${tokenAddress}'`)
  await query_db(`UPDATE lp_pool SET blacklist=true, liquidity_criteria_low=false,liquidity_criteria_medium=false,liquidity_criteria_high=false WHERE token0_address='${tokenAddress}' OR token1_address='${tokenAddress}'`)
  console.log(`Token ${tokenAddress} added to blacklist.`)
}
