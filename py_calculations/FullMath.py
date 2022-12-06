from YulOperations import *


def mulDiv(a, b, denominator):
    result = (a * b) // denominator
    return result


def mulDivRoundingUp(a, b, denominator):
    result = mulDiv(a, b, denominator)
    if mulmod(a, b, denominator) > 0:
        assert result < 2 ** 256 - 1, "FAIL!"
        result += 1
    return result
