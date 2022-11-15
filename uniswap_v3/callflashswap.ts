import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { ethers } from "ethers";
import { getAuthSigner, getProvider, getSigner, getWallet } from "../../settings/provider";
import { address } from "../address";
import { erc20_abi } from "../arbitrageobject/erc20";

const flashAddress = "0xD5e7a722768918877DcA2585a68358761991772E";
const flashABI = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  { stateMutability: "payable", type: "fallback" },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "tokenBorrow", type: "address" },
      { internalType: "address", name: "tokenBase", type: "address" },
      { internalType: "address", name: "pool1", type: "address" },
      { internalType: "address", name: "pool2", type: "address" },
      { internalType: "uint256", name: "borrowAmount", type: "uint256" },
      { internalType: "uint256", name: "repayAmount", type: "uint256" },
      { internalType: "uint256", name: "swapOutAmount", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "simpleFlashSwap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_sender", type: "address" },
      { internalType: "uint256", name: "_amount0", type: "uint256" },
      { internalType: "uint256", name: "_amount1", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "uniswapV2Call",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "int256", name: "amount0Delta", type: "int256" },
      { internalType: "int256", name: "amount1Delta", type: "int256" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "uniswapV3SwapCallback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_tokenContract", type: "address" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
];
const signer = getSigner();
const wallet = getWallet()
const flashContract = new ethers.Contract(flashAddress, flashABI, signer);
const provider = getProvider()

const flashbotSigner = getSigner('flashbot','rpc')
const flashContract_flashbot = new ethers.Contract(flashAddress, flashABI, flashbotSigner);
const authSigner = getAuthSigner()


const weth_contract = new ethers.Contract(
  address.token.weth,
  erc20_abi,
  signer
);

// Call contract for flashswap
export async function callFlashswap(profit: any) {
    if (profit.status !== 0) return;

    

    const gasPrice = await signer.getGasPrice();
    const gas_price_buffer = ethers.utils.parseUnits("2", "gwei");
    const prio_gas = ethers.utils.parseUnits("2", "gwei");

    const profit_threshold = 0.001;
    const estimateProfit = Number(ethers.utils.formatEther(profit.profitAmount));
    const contractInput = profit.contract_input;

    const encodedataV3 = ethers.utils.defaultAbiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [
        contractInput.pool1Type,
        contractInput.pool2Type,
        contractInput.pool1sqrtPriceLimitX96,
        contractInput.pool2sqrtPriceLimitX96,
        ]
    );
    let tx_settings, gas, gaslimit;

    try {
        // V2 function
        // gaslimit = await flashswap.estimateGas.simpleFlashSwap(tokenBorrow,tokenBase,pool1,pool2,borrowAmount,repayAmount,swapOutAmount)
        // V3 function
        gaslimit = await flashContract.estimateGas.simpleFlashSwap(
        contractInput.tokenBorrow,
        contractInput.tokenBase,
        contractInput.pool1,
        contractInput.pool2,
        contractInput.borrowAmount,
        contractInput.repayAmount,
        contractInput.swapOutAmount,
        encodedataV3
        );
        gas = ethers.utils.formatEther(gasPrice.mul(gaslimit));

        if (estimateProfit > Number(gas) + profit_threshold && Number(gas) < 0.01) {

            tx_settings = {
                nonce: await signer.getTransactionCount(),
                gasPrice: gasPrice.add(gas_price_buffer).add(prio_gas),
                gasLimit: ethers.BigNumber.from(
                Math.round(gaslimit.toNumber() * 1.1).toString()
                ),
                from:wallet.address
            };
            // EIP 1559 tx setting
            // tx_settings = {
            //     nonce: await signer.getTransactionCount(),
            //     maxPriorityFeePerGas: prio_gas,
            //     maxFeePerGas: gasPrice.add(gas_price_buffer).add(prio_gas),
            //     gasLimit: ethers.BigNumber.from(
            //     Math.round(gaslimit.toNumber() * 1.1).toString()
            //     ),
            // };

            let contract_WETH_balance = await weth_contract.balanceOf(
                flashContract.address
            );
            console.log(
                `Contract WETH Balance before: ${ethers.utils.formatEther(
                contract_WETH_balance
                )} `
            );

            // Building transaction and submit to flashbots
            const rawtx = await flashContract.populateTransaction.simpleFlashSwap(
                contractInput.tokenBorrow,
                contractInput.tokenBase,
                contractInput.pool1,
                contractInput.pool2,
                contractInput.borrowAmount,
                contractInput.repayAmount,
                contractInput.swapOutAmount,
                encodedataV3,
                tx_settings
            );

            const maxBlockNumber = (await provider.getBlockNumber()) + 3
            const flashbotsProvider = await FlashbotsBundleProvider.create(
                provider, // a normal ethers.js provider, to perform gas estimiations and nonce lookups
                authSigner // ethers.js signer wallet, only for signing request payloads, not transactions
                )
            const privateTx = {
                transaction: rawtx,
                signer: wallet,
            }

            const res = await flashbotsProvider.sendPrivateTransaction(privateTx,{maxBlockNumber})         
            console.log(`Tx Pending`)
            console.log(res)

            console.log(
                `Contract WETH Balance After: ${ethers.utils.formatEther(
                contract_WETH_balance
                )} `
            );
        } else {
        console.log(
            `Gas cost ${gas} | Profit: ${estimateProfit} | HIGH GAS COST `
        );
        }
    } catch (err:any) {
        console.log(`Fail to call Flashswap (${err.reason})`);
    }
}
