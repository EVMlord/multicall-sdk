// constants
export { ChainId, getMulticallAddress } from "./constants";

// ABI
export { Multicall3ABI } from "./ABIs";

// the Multicall class + its types
export { default as Multicall } from "./ethers-multicall";

export type {
  Call,
  Call3,
  Call3Value,
  ConstructorArgs as MulticallConstructorArgs,
  MulticallResult as MulticallRawResult,
} from "./types";
