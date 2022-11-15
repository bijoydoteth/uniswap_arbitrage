import { abi as IUniswapV3FactoryABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import { ethers } from 'ethers';
import { getProvider, getSigner } from '../../settings/provider';
import { query_db } from '../../settings/setupdb';
import { address } from '../address';
const provider = getProvider()

async function getnewPool(TokenAddress?:string){
    const uniswap_v3_factory = address.dex.uniswap.v3.factory
    const factory_contract = new ethers.Contract(uniswap_v3_factory,IUniswapV3FactoryABI,provider)

    const token0 = address.token.weth

    const dex_name = 'uniswap_v3'
    const pool_type = 'uniswapV3'
    const router_address = address.dex.uniswap.v3.router
    const network = 'ethereum'
    const fee_bps = [0.0005,0.003,0.01]

    let query_result = (await query_db(`SELECT address FROM erc20_contract`)).rows
    const startFromToken = 3000
    query_result.splice(0,startFromToken)

    if (TokenAddress){
        query_result = [{address:TokenAddress}]
    }
    let totalToken = query_result.length
    let counter = 1
    console.log(`Searching for ${totalToken} tokens pools that paired with WETH`)
    let startTime,endTime
    startTime = performance.now()

    for (const row of query_result){
        const token1 = row.address

        let token0_address,token1_address
        if (token0.toLowerCase()<token1.toLowerCase()){
            token0_address = token0
            token1_address = token1
        }else{
            token0_address = token1
            token1_address = token0
        }
        
        for (const fee of fee_bps){
            const lp_address = await factory_contract.getPool(token0,token1,fee*1000000)
            if (lp_address!==ethers.constants.AddressZero){
                const query_string = `INSERT INTO lp_pool (address,network,dex_name,token0_address,token1_address,router_address,fee,pool_type) VALUES ('${lp_address}','${network}','${dex_name}','${token0_address}','${token1_address}','${router_address}',${fee},'${pool_type}') ON CONFLICT DO NOTHING;`
                query_db(query_string)
                // console.log(`Pool: ${lp_address}`)
            }
        }
        counter+=1
        if (counter%1000===0){
            endTime = performance.now()
            const totaltime = Math.round(((endTime - startTime) / 1000)*1000)/1000
            console.log(`Progress: ${counter} / ${totalToken} | Time: ${totaltime}s`)
            startTime = performance.now()
        }
    }
    
}

if (require.main === module) {
    getnewPool();
}
