// constants
export * from "./constants";

// the Multicall class + its types
export { default as Multicall } from "./ethers-multicall";

export type {
  Call,
  Call3,
  Call3Value,
  ConstructorArgs as MulticallConstructorArgs,
  MulticallResult as MulticallRawResult,
} from "./ethers-multicall";
