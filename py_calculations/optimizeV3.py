from TickMath import getSqrtRatioAtTick,getTickAtSqrtRatio
from SwapMath import computeSwapStep
import json
from TickBitmap import position
from fractions import Fraction
from scipy.optimize import minimize_scalar

## V2 Functions
def swapAmountV2(
    reserves_token0:int,
    reserves_token1:int,
    token0_address:str,
    token1_address:str,
    token_quantity:int,
    token_address:str,
    is_input:bool,
    fee=Fraction(3, 1000),
    ):

    assert (token_address==token0_address or token_address==token1_address), 'Token not found in LP pool'
    
    if is_input:
        token_in_quantity=token_quantity

        if (token_address==token0_address):
            token_in='token0'
        else:
            token_in='token1'

        
        amount = getAmountOut(reserves_token0,reserves_token1,token_in_quantity,token_in)
        return amount
        
    if not is_input:
        token_out_quantity=token_quantity

        if (token_address==token0_address):
            token_out='token0'
        else:
            token_out='token1'
        
        amount = getAmountIn(reserves_token0,reserves_token1,token_out_quantity,token_out)
        return amount
        
def getAmountIn(
    reserves_token0,
    reserves_token1,
    token_out_quantity,
    token_out,
    fee=Fraction(3, 1000),
):
    """
    Calculates the required token INPUT of token_in for a target OUTPUT at current pool reserves.
    Uses the self.token0 and self.token1 pointers to determine which token is being swapped in
    and uses the appropriate formula

    Assumes token_in is token0, token_out is token1
    """

    if token_out == "token1":
        if (token_out_quantity>reserves_token1): 
            return 0

        return int(
            (reserves_token0 * token_out_quantity)
            // ((1 - fee) * (reserves_token1 - token_out_quantity))
            + 1
        )

    if token_out == "token0":
        if (token_out_quantity>reserves_token0): 
            return 0
        return int(
            (reserves_token1 * token_out_quantity)
            // ((1 - fee) * (reserves_token0 - token_out_quantity))
            + 1
        )

def getAmountOut(
    reserves_token0,
    reserves_token1,
    token_in_quantity,
    token_in,
    fee=Fraction(3, 1000),
):
    """
    Calculates the expected token OUTPUT for a target INPUT at current pool reserves.
    Uses the self.token0 and self.token1 pointers to determine which token is being swapped in
    and uses the appropriate formula

    Assumes token_in is token1, token_out is token0
    """

    if token_in == "token0":
        return int(reserves_token1 * token_in_quantity * (1 - fee)) // int(
            reserves_token0 + token_in_quantity * (1 - fee)
        )-1

    if token_in == "token1":
        return int(reserves_token0 * token_in_quantity * (1 - fee)) // int(
            reserves_token1 + token_in_quantity * (1 - fee)
        )-1


# V3 Functions
def getNextTick(tickMap,currentTick:int,toLeft:bool,tickMapRange):

    # Check if current Tick is in the tick range
    if (currentTick<=tickMapRange[0] or currentTick>=tickMapRange[1]):
        return None

    # If no next tick to fetch but within the tickMapRange, create a virtual tick
    if (len(tickMap)>0):
        if (toLeft and currentTick<tickMap[len(tickMap)-1][0]):
                return [tickMapRange[0],0,0]
        elif((not toLeft) and currentTick>tickMap[0][0]):
                return [tickMapRange[1],0,0]
    else:
        if (toLeft):
            return [tickMapRange[0],0,0]
        else:
            return [tickMapRange[1],0,0]
    
    newtickMap = []

    if toLeft:
        # Find all ticks below current tick
        for i in range(len(tickMap)):
            if (tickMap[i][0]<currentTick):
                newtickMap.append(tickMap[i])

        if(len(newtickMap)==0): 
            return None
        else:
            return newtickMap[0]
    else:
        # Find all ticks above current tick
        for i in range(len(tickMap)):
            if (tickMap[i][0]>currentTick):
                newtickMap.append(tickMap[i])
        if(len(newtickMap)==0): 
            return None
        else:
            return newtickMap[len(newtickMap)-1]

def swapAmount(amount:int,tokenAddress:str,isInput:str,poolparam):
    if isinstance(poolparam,str):
        pool_data = json.loads(poolparam)
    else:
        pool_data = poolparam
    
    assert (pool_data["token0Address"]==tokenAddress) or (pool_data["token1Address"]==tokenAddress), 'tokenAddress not found in this LP pool'
    poolType = pool_data['poolType']

    if(poolType=='uniswapV3'):
        
        state = {
            'amountSpecifiedRemaining': amount,
            'amountCalculated': 0,
            'sqrtPriceX96': int(pool_data['sqrtPriceX96']),
            'tick': pool_data['currentTick'],
            'liquidity': int(pool_data['liquidity']),       
        }
        fee = pool_data['fee']
        currentTick = pool_data['currentTick']
        tickSpacing = pool_data['tickSpacing']
        tickMapRange = pool_data['tickMapRange']
        tickMapraw = pool_data['tickMap']
        tickMap = []
        # TickMap map tick to liquidityNet
        for i in range(len(tickMapraw)):
            tickMap.append([tickMapraw[i][0],tickMapraw[i][1]])

        pos = position(currentTick//tickSpacing)
        
        if(isInput=='true'):
            if (pool_data["token0Address"]==tokenAddress):
                # tokenIn = 'token0'
                toLeft = True
            else:
                # tokenIn = 'token1'
                toLeft = False

            while (state['amountSpecifiedRemaining']>0):
                sqrtPriceStartX96 = state['sqrtPriceX96']
                nextTick = getNextTick(tickMap,state['tick'],toLeft,tickMapRange)
                # If cannot fetch next tick return with the last state value

                if (nextTick==None):
                    lastTick = state['tick']
                    lastsqrtPrice = getSqrtRatioAtTick(lastTick)
                    return [state['amountCalculated'],lastsqrtPrice]
                        
                # Calculate amount in and out to the next tick
                sqrtPriceNextX96 = getSqrtRatioAtTick(nextTick[0])
                computeAmounts = computeSwapStep(sqrtPriceStartX96,sqrtPriceNextX96,state['liquidity'],state['amountSpecifiedRemaining'],fee)

                amountIn = int(computeAmounts[1])+int(computeAmounts[3])
                amountOut = int(computeAmounts[2])

                # Update State
                state['sqrtPriceX96'] = sqrtPriceNextX96
                state['tick'] = nextTick[0]
                state['amountSpecifiedRemaining'] -= amountIn
                state['amountCalculated'] +=amountOut
                

                if (toLeft):
                    state['liquidity']-= int(nextTick[1])

                    if (sqrtPriceNextX96<computeAmounts[0]):
                        state['sqrtPriceX96'] = computeAmounts[0]
                        state['tick'] = getTickAtSqrtRatio(state['sqrtPriceX96'])
                else:
                    state['liquidity']+= int(nextTick[1])

                    if (sqrtPriceNextX96>computeAmounts[0]):
                        state['sqrtPriceX96'] = computeAmounts[0]
                        state['tick'] = getTickAtSqrtRatio(state['sqrtPriceX96'])            
        else:
            if (pool_data["token0Address"]==tokenAddress):
                # tokenIn = 'token1'
                toLeft = False
            else:
                # tokenIn = 'token0'
                toLeft = True

            while (state['amountSpecifiedRemaining']>0):
                
                sqrtPriceStartX96 = state['sqrtPriceX96']
                nextTick = getNextTick(tickMap,state['tick'],toLeft,tickMapRange)

                if (nextTick==None):
                    lastTick = state['tick']
                    lastsqrtPrice = getSqrtRatioAtTick(lastTick)
                    return [0,lastsqrtPrice]

                sqrtPriceNextX96 = getSqrtRatioAtTick(nextTick[0])

                computeAmounts = computeSwapStep(sqrtPriceStartX96,sqrtPriceNextX96,state['liquidity'],-state['amountSpecifiedRemaining'],fee)

                amountIn = int(computeAmounts[1])+int(computeAmounts[3])
                amountOut = int(computeAmounts[2])

                # Update State
                state['sqrtPriceX96'] = sqrtPriceNextX96
                state['tick'] = nextTick[0]
                state['amountSpecifiedRemaining'] -= amountOut
                state['amountCalculated'] +=amountIn
                

                if (toLeft):
                    state['liquidity']-= int(nextTick[1])

                    if (sqrtPriceNextX96<computeAmounts[0]):
                        state['sqrtPriceX96'] = computeAmounts[0]
                        state['tick'] = getTickAtSqrtRatio(state['sqrtPriceX96'])
                else:
                    state['liquidity']+= int(nextTick[1])

                    if (sqrtPriceNextX96>computeAmounts[0]):
                        state['sqrtPriceX96'] = computeAmounts[0]
                        state['tick'] = getTickAtSqrtRatio(state['sqrtPriceX96'])

        
        lastTick = state['tick']
        lastsqrtPrice = getSqrtRatioAtTick(lastTick)
        return [state['amountCalculated'],lastsqrtPrice]
        
    elif(poolType=='uniswapV2'):
        reserve0 = int(pool_data['reserve0'])
        reserve1 = int(pool_data['reserve1'])
        token0_address = pool_data["token0Address"]
        token1_address = pool_data["token1Address"]

        if (isInput=='true' or isInput==True):
            _isInput = True

        else:
            _isInput = False
        
        resultAmount = swapAmountV2(reserve0,reserve1,token0_address,token1_address,amount,tokenAddress,_isInput,Fraction(3, 1000))
        # print(f'Borrow Amount: {amount} |  Result Amount: {resultAmount} | Input: {_isInput}')

        return [int(resultAmount),0]

def swapAmountMultiHop(amount:int,FirstToken:str,isInput:str,poolparams:str):
    if isinstance(poolparams,str):
        pool_data = json.loads(poolparams)
    else:
        pool_data = poolparams

    tempAmount = amount
    swapAmountToken = FirstToken
    if isInput=='true':
        for i in range(len(pool_data)):
            resultAmount = swapAmount(tempAmount,swapAmountToken,'true',json.dumps(pool_data[i]))

            tempAmount = resultAmount[0]
            if (pool_data[i]['token0Address']==swapAmountToken):
                swapAmountToken = pool_data[i]['token1Address']
            else:
                swapAmountToken = pool_data[i]['token0Address']

    else:
        for i in range(len(pool_data)):
            resultAmount = swapAmount(tempAmount,swapAmountToken,'false',json.dumps(pool_data[-(1+i)]))

            tempAmount = resultAmount[0]
            
            if (pool_data[-(1+i)]['token0Address']==swapAmountToken):
                swapAmountToken = pool_data[-(1+i)]['token1Address']
            else:
                swapAmountToken = pool_data[-(1+i)]['token0Address']

    return resultAmount

def getSpotPrice(poolparam:str,baseCurrency:str=None,feeAdjusted:str='false')->Fraction:
    pool_data = json.loads(poolparam)
    poolType = pool_data['poolType']

    token0_address = pool_data["token0Address"]
    token1_address = pool_data["token1Address"]
    token0_decimal = pool_data["token0Decimal"]
    token1_decimal = pool_data["token1Decimal"]
    wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

    if(baseCurrency==None):
        if(token0_address==wethAddress or token1_address==wethAddress):
            baseCurrency=wethAddress
        else:
            baseCurrency = token0_address
    else:
        assert (baseCurrency==token0_address or baseCurrency==token1_address), 'Base currency not found in this LP'

    # if(self.token0.decimals==0 or self.token1.decimals==0):
    #     return None

    if (baseCurrency==token0_address):
        decimal_diff = token0_decimal - token1_decimal

        if(poolType=='uniswapV3'):
            sqrtPriceX96 = int(pool_data["sqrtPriceX96"])
            ratio = Fraction((sqrtPriceX96 ** 2) / (2 ** 192))
            price = Fraction(((sqrtPriceX96 ** 2) / (2 ** 192))*(10**(decimal_diff)))

        if(poolType=='uniswapV2'):
            reserve0 = int(pool_data["reserve0"])
            reserve1 = int(pool_data["reserve1"])
            if (reserve0==0 or reserve1==0):
                return None
            ratio = Fraction(reserve1/reserve0)
            price = Fraction((reserve1/reserve0)*(10**(decimal_diff)))
    else:
        decimal_diff = token1_decimal - token0_decimal

        if(poolType=='uniswapV3'):
            sqrtPriceX96 = int(pool_data["sqrtPriceX96"])
            ratio = Fraction((2 ** 192) / (sqrtPriceX96 ** 2))
            price = Fraction(( (2 ** 192) / (sqrtPriceX96 ** 2) )*(10**(decimal_diff)))

        if(poolType=='uniswapV2'):
            reserve0 = int(pool_data["reserve0"])
            reserve1 = int(pool_data["reserve1"])
            if (reserve0==0 or reserve1==0):
                return None
            ratio = Fraction(reserve0/reserve1)
            price = Fraction((reserve0/reserve1)*(10**(decimal_diff)))

    if feeAdjusted=='true':
        fee = pool_data["fee"] / 1000000
        price = price * (1-fee)
        ratio = ratio * (1-fee)
    

    return [float(price),float(ratio)]

# Optimize V3 Borrow amount
def calc_profit(borrowAmount:int,borrowAddress:str,poolcheap_param:str,poolexp_param:str):
        borrowAmount = int(borrowAmount)
        # get repayment INPUT at borrow_amount OUTPUT
        [flash_repay_amount, p1sqrtPriceX96]= swapAmount(borrowAmount,borrowAddress,'false',poolcheap_param)
        [swap_amount_out, p2sqrtPriceX96] = swapAmount(borrowAmount,borrowAddress,'true',poolexp_param)
        if (flash_repay_amount==0):
            return 0
        else:
            profit = int(swap_amount_out) - int(flash_repay_amount)
            return int(profit)

def optimizePool(borrowAddress:str,pool1param:str,pool2param:str):
    pool_data1 = json.loads(pool1param)
    pool_data2 = json.loads(pool2param)
    p1t0_address = pool_data1["token0Address"]
    p1t1_address = pool_data1["token1Address"]
    p2t0_address = pool_data2["token0Address"]
    p1t0_decimals = pool_data1['token0Decimal']
    p1t1_decimals = pool_data1['token1Decimal']
    p2t0_decimals = pool_data2['token0Decimal']
    p2t1_decimals = pool_data2['token1Decimal']

    # Determine pool rates
    if (borrowAddress==p1t0_address):
        baseAddress=p1t1_address
        p1baseToken = 'token1'
    else:
        baseAddress=p1t0_address
        p1baseToken='token0'
    
    if (borrowAddress==p2t0_address):
        p2baseToken='token1'
    else:
        p2baseToken='token0'

    [p1Price,p1Ratio] = getSpotPrice(pool1param,baseAddress)
    [p2Price,p2Ratio] = getSpotPrice(pool2param,baseAddress)

    # Pool1 Cheaper than Pool2 (borrow from p1 and sell on p2)
    def getmaxBorrowReserve(pool_data,borrowAddress,price):
            if(borrowAddress==pool_data['token0Address']):
                borrowReserve = int(pool_data['token0balance'])
                baseReserve = int(pool_data['token1balance'])
                baseEquivBorrowReserve = int((baseReserve*price)*(10**(p1t0_decimals-p1t1_decimals)))
            else:
                borrowReserve = int(pool_data['token1balance'])
                baseReserve = int(pool_data['token0balance'])
                baseEquivBorrowReserve = int((baseReserve*price)*(10**(p1t1_decimals-p1t0_decimals)))
            
            return min(borrowReserve,baseEquivBorrowReserve)
    
    if(p1Price<p2Price):
        poolcheap_param = pool2param
        poolexp_param = pool1param

        p1maxBorrow = getmaxBorrowReserve(pool_data1,borrowAddress,p1Price)
        p2maxBorrow = getmaxBorrowReserve(pool_data2,borrowAddress,p1Price)  
    else:
        poolcheap_param = pool1param
        poolexp_param = pool2param

        p1maxBorrow = getmaxBorrowReserve(pool_data1,borrowAddress,p2Price)
        p2maxBorrow = getmaxBorrowReserve(pool_data2,borrowAddress,p2Price)

    
    borrowLimit = min(p1maxBorrow,p2maxBorrow)
    
    optimal = minimize_scalar(
        lambda x: -float(calc_profit(x,borrowAddress,poolcheap_param,poolexp_param)),
        method="bounded",
        bounds=(1,0.8*borrowLimit+2),
        bracket=(0.01*borrowLimit,0.05*borrowLimit),
    )
    optimal_borrow = str(int(optimal.x))
    profit = str(int(-optimal.fun))

    # Calculate Repay on poolcheap and swapout amount on poolexp
    [repayAmount, p1sqrtPriceX96] = swapAmount(int(optimal_borrow),borrowAddress,'false',poolcheap_param)
    [swapOutAmount, p2sqrtPriceX96] = swapAmount(int(optimal_borrow),borrowAddress,'true',poolexp_param)
    repayAmount = str(int(repayAmount))
    swapOutAmount = str(int(swapOutAmount))
    p1sqrtPriceX96 = str(int(p1sqrtPriceX96))
    p2sqrtPriceX96 = str(int(p2sqrtPriceX96))


    poolcheap_data = json.loads(poolcheap_param)
    poolexp_data = json.loads(poolexp_param)

    pool1Type=0
    pool2Type=0
    if poolcheap_data['poolType']=='uniswapV3':
        pool1Type=1
    if poolexp_data['poolType']=='uniswapV3':
        pool2Type=1

    outputraw = {
        'optimal_borrow':optimal_borrow,
        'profit':profit,
        'repayAmount':repayAmount,
        'swapOutAmount':swapOutAmount,
        'pool1':poolcheap_data['poolAddress'],
        'pool2':poolexp_data['poolAddress'],
        'pool1Type':pool1Type,
        'pool2Type':pool2Type,
        'p1sqrtPriceX96':p1sqrtPriceX96,
        'p2sqrtPriceX96':p2sqrtPriceX96,
        'tokenBorrow':borrowAddress,
        'tokenBase':baseAddress,
        }

    output = json.dumps(outputraw)
    return output
    
def calcProfitMultiHop(borrowAmount:int,borrowAddress:str,poolparams):
    if isinstance(poolparams,str):
        pool_data = json.loads(poolparams)
    else:
        pool_data = poolparams

    borrowAmount = int(borrowAmount)

    [flash_repay_amount, p1sqrtPriceX96]= swapAmount(borrowAmount,borrowAddress,'false',pool_data[0])
    [swap_amount_out, p2sqrtPriceX96] = swapAmountMultiHop(borrowAmount,borrowAddress,'true',pool_data[1:])

    if (flash_repay_amount==0):
        return 0
    else:
        profit = int(swap_amount_out) - int(flash_repay_amount)
        return int(profit)

def optimizeMultiHop(borrowAddress:str,poolparams:str):
    pool_data = json.loads(poolparams)

    if (pool_data[0]['token0Address']==borrowAddress):
        borrowLimit = int(pool_data[0]['token0balance'])
        baseAddress = pool_data[0]['token1Address']
    else:
        borrowLimit = int(pool_data[0]['token1balance'])
        baseAddress = pool_data[0]['token0Address']

    optimal = minimize_scalar(
        lambda x: -float(calcProfitMultiHop(x,borrowAddress,pool_data)),
        method="bounded",
        bounds=(1,0.8*borrowLimit),
        bracket=(0.01*borrowLimit,0.05*borrowLimit),
    )
    optimal_borrow = str(int(optimal.x))
    profit = str(int(-optimal.fun))

    [repayAmount, pInsqrtPriceX96] = swapAmount(int(optimal_borrow),borrowAddress,'false',pool_data[0])
    [swapOutAmount, pOutsqrtPriceX96] = swapAmountMultiHop(int(optimal_borrow),borrowAddress,'true',pool_data[1:])

    if (repayAmount==0):
        optimal_borrow=str(int(0))

    repayAmount = str(int(repayAmount))
    swapOutAmount = str(int(swapOutAmount))
    pInsqrtPriceX96 = str(int(pInsqrtPriceX96))
    pOutsqrtPriceX96 = str(int(pOutsqrtPriceX96))

    outputraw = {
        'optimal_borrow':optimal_borrow,
        'profit':profit,
        'repayAmount':repayAmount,
        'swapOutAmount':swapOutAmount,
        'pInsqrtPriceX96':pInsqrtPriceX96,
        'pOutsqrtPriceX96':pOutsqrtPriceX96,
        'tokenBorrow':borrowAddress,
        'tokenBase':baseAddress,
        }

    output = json.dumps(outputraw)
    return output

    

