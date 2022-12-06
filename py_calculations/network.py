import networkx as nx
import math, json
from provider import query_db


def getGraph():
    GraphData = (query_db(f"SELECT graph_object FROM graph_db WHERE graph_number=1;"))[
        0
    ][0]
    G = nx.node_link_graph(GraphData)
    return G


def graphFindPoolEdge(G, poolAddress):
    result = []
    for edge in G.edges(data=True):
        if edge[2]["key"] == poolAddress:
            result.append(edge)

    return result


def graphFindCycleEdges(G, cycle):
    edges = []
    for i in range(len(cycle) - 1):
        edge = [cycle[i], cycle[i + 1], G.get_edge_data(cycle[i], cycle[i + 1])]
        edges.append(edge)

    return edges


def graphFindCycleROI(G, cycle):
    edges = graphFindCycleEdges(G, cycle)
    factor = 1

    for edge in edges:
        factor = factor * edge[2]["ratiof"]

    return factor


# Modify weight to find more negative cycles
def graphFindNegCycle(graph, source, adjustPercentage):
    def graphAdjustEdgeWeight(source, target, attr):
        weights = []
        for edge in attr:
            weights.append(attr[edge]["weight"])

        minWeight = min(weights)
        extraWeight = -math.log(1 - (adjustPercentage / 100))
        return minWeight + extraWeight

    cycle = nx.find_negative_cycle(graph, source, graphAdjustEdgeWeight)

    return cycle


# Return a list of possible paths to next neighbor nodes
def findNextNeighbors(G, currentPath):
    path = currentPath
    possiblePaths = []
    cycle = []
    neighbors = list(nx.neighbors(G, currentPath[-1]))

    for neighbor in neighbors:
        if not (neighbor in path):
            # pass
            newPath = list(path)
            newPath.append(neighbor)
            possiblePaths.append(newPath)

        if neighbor == path[0]:
            newPath = list(path)
            newPath.append(neighbor)
            cycle.append(newPath)

    return possiblePaths, cycle


def findNextNeighborsBulk(G, currentPathList):
    bulk_posPath = []
    bulk_cycle = []
    for currentPath in currentPathList:
        cur_posPath, cur_cycle = findNextNeighbors(G, currentPath)

        if len(cur_posPath) > 0:
            for posPath in cur_posPath:
                bulk_posPath.append(posPath)

        if len(cur_cycle) > 0:
            for cycle in cur_cycle:
                bulk_cycle.append(cycle)

    return bulk_posPath, bulk_cycle


def findPossibleCycles(G, startingEdge, maxPathLength):
    startPath = startingEdge
    iteration = maxPathLength - 2
    all_posPath = []
    all_cycle = []
    all_cycle_flatten = []

    # Starting edges in both direction
    currentPathList = [startPath, [startPath[1], startPath[0]]]

    for i in range(iteration):
        posPath, cycle = findNextNeighborsBulk(G, currentPathList)
        all_posPath.append(posPath)
        all_cycle.append(cycle)
        currentPathList = list(posPath)

    for round in all_cycle:
        for cycle in round:
            all_cycle_flatten.append(cycle)

    return all_cycle_flatten


def findPossibleCyclesEdges(G, tokenPath):
    if isinstance(tokenPath, str):
        tokenPath = json.loads(tokenPath)

    cycles = findPossibleCycles(G, tokenPath, 4)
    baseTokenList = [
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "0x4Fabb145d64652a948d72533023f6E7A623C7C53",
        "0x0000000000085d4780B73119b644AE5ecd22b376",
        "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6",
        "0x8e870d67f660d95d5be530380d0ec0bd388289e1",
        "0x853d955aCEf822Db058eb8505911ED77F175b99e",
    ]
    # Filter cycles that only contains base token at the start of the path
    filteredcycles = [cycle for cycle in cycles if cycle[0] in baseTokenList]

    cyclesProfit = graphFindBulkCycleWeights(G, filteredcycles)

    cyclePaths = list(map(lambda x: x["cycle"], cyclesProfit[:10]))
    paths = graphFindCyclesPoolPaths(G, cyclePaths)
    return json.dumps(paths)


def graphFindBulkCycleWeights(G, cycles):
    cyclesProfit = []
    for cycle in cycles:
        totalWeight = nx.path_weight(G, cycle, "weight")
        if totalWeight < 0:
            cyclesProfit.append({"cycle": cycle, "totalweight": totalWeight})

    return sorted(cyclesProfit, key=lambda d: d["totalweight"])


def graphFindCyclePoolPaths(G, cycle):
    poolpaths = []
    edges = graphFindCycleEdges(G, cycle)
    for edge in edges:
        poolpaths.append(edge[2]["key"])

    return poolpaths


def graphFindCyclesPoolPaths(G, cycles):
    poolpathslist = []

    for cycle in cycles:
        paths = graphFindCyclePoolPaths(G, cycle)
        poolpathslist.append({"tokens": cycle, "pools": paths})

    return poolpathslist
