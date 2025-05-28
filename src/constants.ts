/** All supported chain IDs */
export enum ChainId {
  MAINNET = 1,
  ROPSTEN = 3,
  RINKEBY = 4,
  GÖRLI = 5,
  KOVAN = 42,
  MATIC = 137,
  MATIC_TESTNET = 80001,
  FANTOM = 250,
  FANTOM_TESTNET = 4002,
  XDAI = 100,
  BSC = 56,
  BSC_TESTNET = 97,
  ARBITRUM = 42161,
  ARBITRUM_TESTNET = 79377087078960,
  MOONBEAM_TESTNET = 1287,
  AVALANCHE = 43114,
  AVALANCHE_TESTNET = 43113,
  HECO = 128,
  HECO_TESTNET = 256,
  HARMONY = 1666600000,
  HARMONY_TESTNET = 1666700000,
  OKEX = 66,
  OKEX_TESTNET = 65,
  CRONOS = 25,
  CRONOS_TESTNET = 338,
  AURORA = 1313161554,
  AURORA_TESTNET = 1313161555,
  AURORA_BETANET = 1313161556,
  MOONRIVER = 1285,
  OPTIMISM = 10,
  XRPLEVM_TESTNET = 1449000,
}

export enum VERSION {
  V1,
}

/**
 * Map exactly the values in ChainId to on-chain contract addresses.
 *
 * We use Partial<> here because we may not deploy a given contract on every network.
 */
export type AddressType = Partial<Record<ChainId, string>>;

export const addresses = {
  Multicall: <AddressType>{
    [ChainId.MAINNET]: "0x2c7002B316507F228BC6E10855856Ba93114EbB8",
    [ChainId.BSC]: "0x134f94adA24A7ed01AF204D72e7FcFf97E5538da",
    [ChainId.BSC_TESTNET]: "0x06084aF049CA61B1FC7E65a95dB09695E4014d5a",
    [ChainId.ARBITRUM]: "0x2697B961c5504190502533b69177f3912d3D450B",
    [ChainId.XRPLEVM_TESTNET]: "0x3f012a7C54dF759B145740454f61A2F2457A3028",
  },
};
