import sys
import json
from TickMath import getSqrtRatioAtTick,getTickAtSqrtRatio
from SqrtPriceMath import getNextSqrtPriceFromAmount0RoundingUp,getNextSqrtPriceFromAmount1RoundingDown,getNextSqrtPriceFromInput,getNextSqrtPriceFromOutput,getAmount0Delta,getAmount1Delta
from UnsafeMath import divRoundingUp
# from TickBitmap import position,nextInitializedTickWithinOneWord
from FullMath import mulDiv,mulDivRoundingUp
from SwapMath import computeSwapStep
from optimizeV3 import swapAmount,getSpotPrice,optimizePool,calc_profit,swapAmountMultiHop,calcProfitMultiHop,optimizeMultiHop
from network import getGraph,findPossibleCyclesEdges

args = []
for line in sys.stdin:
    if 'Exit' == line.rstrip():
        break

    line = line.strip()
    args.append(line)
    
if len(args)>1:
    
    # Optimize pools
    if args[1]=='swapAmount':
        result = swapAmount(int(args[2]),args[3],args[4],args[5])
        print(result)

    if args[1]=='getSpotPrice':
        result = getSpotPrice(args[2],args[3],args[4])
        print(result)

        
    if args[1]=='optimizePool':
        result = optimizePool(args[2],args[3],args[4])
        print(result)

    if args[1]=='calc_profit':
        result = calc_profit(int(args[2]),args[3],args[4],args[5])
        print(result)

    if args[1]=='swapAmountMultiHop':
        result = swapAmountMultiHop(int(args[2]),args[3],args[4],args[5])
        print(result)
    
    if args[1]=='calcProfitMultiHop':
        result = calcProfitMultiHop(int(args[2]),args[3],args[4])
        print(result)

    if args[1]=='optimizeMultiHop':
        result = optimizeMultiHop(args[2],args[3])
        print(result)

    if args[1]=='findPossibleCyclesEdges':
        result = findPossibleCyclesEdges(getGraph(),args[2])
        print(result)

    if args[1]=='test':
        print(args[2])


if len(sys.argv)>1:
    # TickMath
    if sys.argv[1]=='getSqrtRatioAtTick':
        result = getSqrtRatioAtTick(int(sys.argv[2]))
        print(result)

    if sys.argv[1]=='getTickAtSqrtRatio':
        result = getTickAtSqrtRatio(int(sys.argv[2]))
        print(result)

    # SqrtPriceMath
    if sys.argv[1]=='getNextSqrtPriceFromAmount0RoundingUp':
        result = getNextSqrtPriceFromAmount0RoundingUp(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    if sys.argv[1]=='getNextSqrtPriceFromAmount1RoundingDown':
        result = getNextSqrtPriceFromAmount1RoundingDown(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    if sys.argv[1]=='getNextSqrtPriceFromInput':
        result = getNextSqrtPriceFromInput(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    if sys.argv[1]=='getNextSqrtPriceFromOutput':
        result = getNextSqrtPriceFromOutput(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    if sys.argv[1]=='getAmount0Delta':
        result = getAmount0Delta(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    if sys.argv[1]=='getAmount1Delta':
        result = getAmount1Delta(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])
        print(result)

    # UnsafeMath
    if sys.argv[1]=='divRoundingUp':
        result = divRoundingUp(int(sys.argv[2]),int(sys.argv[3]))
        print(result)

    # FullMath
    if sys.argv[1]=='mulDiv':
        result = mulDiv(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]))
        print(result)

    if sys.argv[1]=='mulDivRoundingUp':
        result = mulDivRoundingUp(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]))
        print(result)

    # SwapMath
    if sys.argv[1]=='computeSwapStep':
        result = computeSwapStep(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),int(sys.argv[5]),int(sys.argv[6]))
        print(result)

    # Optimize pools
    if sys.argv[1]=='swapAmount':
        result = swapAmount(int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5])
        print(result)

    if sys.argv[1]=='getSpotPrice':
        result = getSpotPrice(sys.argv[2],sys.argv[3],sys.argv[4])
        print(result)

        
    if sys.argv[1]=='optimizePool':
        result = optimizePool(sys.argv[2],sys.argv[3],sys.argv[4])
        print(result)

    if sys.argv[1]=='calc_profit':
        result = calc_profit(int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5])
        print(result)
