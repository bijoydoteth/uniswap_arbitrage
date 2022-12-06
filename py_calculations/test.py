import sys
from TickMath import getSqrtRatioAtTick,getTickAtSqrtRatio
from SqrtPriceMath import getNextSqrtPriceFromAmount0RoundingUp,getNextSqrtPriceFromAmount1RoundingDown,getNextSqrtPriceFromInput,getNextSqrtPriceFromOutput,getAmount0Delta,getAmount1Delta
from UnsafeMath import divRoundingUp
from FullMath import mulDiv,mulDivRoundingUp
from SwapMath import computeSwapStep
from optimizeV3 import swapAmount
from TickBitmap import position,nextInitializedTickWithinOneWord
import json
from network import *

G = getGraph()
wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
weth_usdc_v3 = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
# edges = graphFindPairEdges(G,wethAddress,usdcAddress)
# print(edges)
tokenPath = [wethAddress,usdcAddress]
cycles = findPossibleCycles(G,tokenPath,4)



# weights = graphFindBulkCycleWeights(G,cycles)
# print(weights)