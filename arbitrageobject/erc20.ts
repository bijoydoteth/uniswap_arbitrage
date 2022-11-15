import { Token } from '@uniswap/sdk-core';
import { ethers } from "ethers";
import { getProvider } from "../../settings/provider";
import { query_db } from "../../settings/setupdb";
const provider = getProvider()

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
]

export class Erc20{
    
    address: string
    network: string
    decimals: number
    symbol?: string
    name?: string
    contract:ethers.Contract

    constructor(param:any){
        this.address = param.address
        this.network = param.network || 'ethereum'
        this.decimals = param.decimals || 0
        this.contract = new ethers.Contract(param.address,erc20_abi,provider)
    }
    

    async init(){
        
        const fetchFromBlockchain = async() =>{
            try{
                this.decimals = await this.contract.decimals()
            }catch(err){
                this.decimals = 0
                console.log(`Cannot fetch token decimals: ${this.address}`)
            }
            
            try{
                this.symbol = String(await this.contract.symbol())
                this.name = String(await this.contract.name())
            }catch(err){
                try{
                    this.contract = await ethers.getVerifiedContractAt(this.address)
                    this.symbol = String(await this.contract.symbol())
                    this.name = String(await this.contract.name())
                    // console.log(`Fetched latest contract of this erc20: ${this.address}`)
                }catch(err){
                    this.symbol = ''
                    this.name = ''
                    // console.log(`Cannot fetch name/symbol of this erc20: ${this.address}`)
                }
            }
            
            try{
                await query_db(`INSERT INTO erc20_contract(address,network,symbol,decimals,name) VALUES ('${this.address}','${this.network}','${this.symbol}',${this.decimals},'${this.name}') `)
            }catch(err:any){
                console.log(`New erc20 db insert error: ${err.code}`)
            }
        }

        const fetchFromDB = async() =>{
            const {symbol,decimals,name} = (await query_db(`SELECT symbol,decimals,name FROM erc20_contract WHERE address='${this.address}'`)).rows[0]
            this.symbol = symbol
            this.decimals = decimals
            this.name = name
        }

        try {
            await fetchFromDB()
        }catch(err){
            await fetchFromBlockchain()
        }           
    }

    async check_balance(address:string){
        if (this.decimals){
            const balance = (await this.contract.balanceOf(address))
            return balance
        }else{
            return
        }
        
    }

}

export async function getErc20(address:string){
    const erc20object = new Erc20({address})
    await erc20object.init()
    return new Token(1, address, erc20object.decimals, erc20object.symbol,erc20object.name)
}

export async function getErc20Balance(token:string|Erc20,balanceAddress:string){
    let erc20object:Erc20
    if (typeof token!=='string'){
        erc20object = token
        console.log('string provided')
    }else{
        
        erc20object = new Erc20({address:token})
        await erc20object.init()
    }
   
    const balance = await erc20object.check_balance(balanceAddress)
    return balance
}