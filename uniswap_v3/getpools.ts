import { abi as IUniswapV3FactoryABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import { ethers } from 'ethers';
import { getProvider, getSigner } from '../../settings/provider';
import { query_db } from '../../settings/setupdb';
import { address } from '../address';
const provider = getProvider()
