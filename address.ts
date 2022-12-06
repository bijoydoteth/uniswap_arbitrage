export const address = {
  dex: {
    uniswap: {
      v2: {
        factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      },
      v3: {
        factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
        ticklens: "0xbfd8137f7d1516D3ea5cA83523914859ec47F573",
        multicall2: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
      },
    },
    sushiswap: {
      factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
      router: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    },
  },
  token: {
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    busd:"0x4Fabb145d64652a948d72533023f6E7A623C7C53",
    tusd:"0x0000000000085d4780B73119b644AE5ecd22b376",
    usdd:"0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6",
    usdp:"0x8e870d67f660d95d5be530380d0ec0bd388289e1",
    frax:"0x853d955aCEf822Db058eb8505911ED77F175b99e",
  },
  bot: {
    v1: "0x25704B20A97c3A1730aE6f2332900F057Ef21f6C",
  },
  other: {
    multicall: "0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441",
  },
  chainlink: {
    ethusd:"0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
  }
};

export const baseToken = {
  baseTokenOrder: [
    { address: address.token.weth, priority: 0 },
    { address: address.token.usdc, priority: 1 },
    { address: address.token.usdt, priority: 2 },
    { address: address.token.dai, priority: 3 },
    { address: address.token.busd, priority: 4 },
    { address: address.token.tusd, priority: 5 },
    { address: address.token.usdd, priority: 6 },
    { address: address.token.usdp, priority: 7 },
    { address: address.token.frax, priority: 8 },
  ],
  stableCoinList:[
    address.token.usdc,
    address.token.dai,
    address.token.usdt,
    address.token.busd,
    address.token.tusd,
    address.token.usdd,
    address.token.usdp,
    address.token.frax,
  ]

};
