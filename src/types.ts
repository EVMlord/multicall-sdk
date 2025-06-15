import { Contract, Provider, Signer } from "ethers";
import { ChainId } from "./constants";

export interface ConstructorArgs {
  /**
   * An Ethers.js provider instance.
   */
  provider: Provider;
  /**
   * Chain ID (enum) for looking up the Multicall contract address.
   * Should correspond to a key in addresses.Multicall.
   */
  chainId?: ChainId;
  /**
   * Optional override for the Multicall contract address.
   */
  multicallAddress?: string;
  /**
   * If you want to send txs, pass in a Signer here.
   */
  signer?: Signer;
}

/**
 * Defines a standard call to be aggregated by Multicall.
 */
export type Call = {
  /**
   * The ethers.Contract instance to call.
   */
  contract: Contract;
  /**
   * The fragment name (function name) on the target contract.
   */
  functionFragment: string;
  /**
   * Arguments for the function call.
   */
  args: any[];
};

/**
 * Extends Call to allow failure without reverting.
 */
export type Call3 = Call & {
  /**
   * Whether individual call failures are allowed.
   */
  allowFailure: boolean;
};

/**
 * Extends Call3 to include sending ETH value with each call.
 */
export type Call3Value = Call3 & {
  /**
   * Amount of ETH (in wei) to send with this call.
   */
  value: bigint;
};

/**
 * Mirrors the Result struct from solidity:
 * struct Result { bool success; bytes returnData; }
 */
export interface MulticallResult {
  success: boolean;
  returnData: string;
}
