import { Provider, Contract, Interface, Result as EthersResult } from "ethers";
import { addresses, ChainId } from "./constants";
import { Multicall3ABI } from "./ABIs";

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
   * Amount of ETH (in wei) to send with the call.
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

/** Type-guard for ethers.Result */
function isEthersResult(x: any): x is EthersResult {
  return (
    x != null &&
    typeof x.toObject === "function" &&
    typeof x.toArray === "function"
  );
}

/**
 * Multicall wraps the Multicall3 Solidity contract for batching on-chain calls.
 */
class Multicall {
  public readonly provider: Provider;
  public readonly target: string;
  public readonly iface: Interface;

  /**
   * @param args.provider    Ethers provider instance
   * @param args.chainId     Optional Chain ID enum for address lookup
   * @param args.multicallAddress Optional explicit contract address
   * @throws Error if no contract address is found
   */
  constructor({ provider, chainId, multicallAddress }: ConstructorArgs) {
    this.provider = provider;

    const address =
      multicallAddress ?? (chainId ? addresses.Multicall[chainId] : undefined);

    if (!address) {
      throw new Error(
        `No multicall address found for chainId ${chainId}; please pass multicallAddress`
      );
    }

    this.target = address;

    this.iface = new Interface(Multicall3ABI);
  }

  /**
   * Low‐level wrapper around `eth_call`.
   * @returns Whatever the ABI says this method returns, typed as T.
   */
  private async rpcCall<T extends any[]>(
    method: string,
    params: any[],
    value?: bigint
  ): Promise<T> {
    // 1) ABI‐encode the call
    const data = this.iface.encodeFunctionData(method, params);
    // 2) Simulate via eth_call
    const raw = await this.provider.call({ to: this.target, data, value });
    // 3) Decode into Ethers’s Result class, then cast to T
    const decoded: EthersResult = this.iface.decodeFunctionResult(method, raw);
    return decoded as unknown as T;
  }

  /**
   * Executes a batch of calls, reverting on any failure.
   * Mirrors: function aggregate(Call[] calldata calls)
   * @param calls - Array of Call objects to batch.
   * @returns An object containing the block number and array
   * of raw return data containing the responsees.
   */
  async aggregate(
    calls: Call[]
  ): Promise<{ blockNumber: bigint; returnData: string[] }> {
    const payload = calls.map(({ contract, functionFragment, args }) => ({
      target: contract.target,
      callData: contract.interface.encodeFunctionData(functionFragment, args),
    }));

    const [blockNumber, returnData] = await this.rpcCall<[bigint, string[]]>(
      "aggregate",
      [payload]
    );

    return { blockNumber, returnData };
  }

  /**
   * Executes a batch of calls, optionally allowing failures.
   * Mirrors: function tryAggregate(bool requireSuccess, Call[] calldata calls)
   * @param requireSuccess - If true, reverts on any failed call.
   * @param calls - Array of Call objects.
   * @returns Array of tuples [success, decodedResult or raw hex].
   */
  async tryAggregate(
    requireSuccess: boolean,
    calls: Call[]
  ): Promise<Array<[boolean, any]>> {
    const payload = calls.map(({ contract, functionFragment, args }) => ({
      target: contract.target,
      callData: contract.interface.encodeFunctionData(functionFragment, args),
    }));

    // Solidity signature: returns (Result[] memory), so decodeFunctionResult gives [MulticallResult[]]
    const [rawResults] = await this.rpcCall<[MulticallResult[]]>(
      "tryAggregate",
      [requireSuccess, payload]
    );

    return rawResults.map((r, i) => {
      if (!r.success) return [false, r.returnData] as [boolean, any];

      try {
        const dec = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );
        const vals = Array.isArray(dec) ? dec : Object.values(dec);
        return [true, vals.length === 1 ? vals[0] : vals] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  /**
   * Executes a batch and returns block info, optionally allowing failures.
   * Mirrors: function tryBlockAndAggregate(bool requireSuccess, Call[] calldata calls)
   * @param requireSuccess - If true, reverts on failed calls.
   * @param calls - Array of Call objects.
   * @returns Object with blockNumber, blockHash, and array of [success, result].
   *
   * Backwards-compatible with Multicall2
   */
  async tryBlockAndAggregate(
    requireSuccess: boolean,
    calls: Call[]
  ): Promise<{
    blockNumber: bigint;
    blockHash: string;
    returnData: Array<[boolean, any]>;
  }> {
    const payload = calls.map(({ contract, functionFragment, args }) => ({
      target: contract.target,
      callData: contract.interface.encodeFunctionData(functionFragment, args),
    }));

    // Solidity returns (uint256, bytes32, Result[]), so decodeFunctionResult gives [bigint, string, MulticallResult[]]
    const [blockNumber, blockHash, rawResults] = await this.rpcCall<
      [bigint, string, MulticallResult[]]
    >("tryBlockAndAggregate", [requireSuccess, payload]);

    const decoded = rawResults.map((r, i) => {
      if (!r.success) return [false, r.returnData] as [boolean, any];

      try {
        const dec = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );
        const vals = Array.isArray(dec) ? dec : Object.values(dec);
        return [true, vals.length === 1 ? vals[0] : vals] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });

    return { blockNumber, blockHash, returnData: decoded };
  }

  /**
   * Executes a batch and returns block info, reverting on any failure.
   * Mirrors: function blockAndAggregate(Call[] calldata calls)
   * @param calls - Array of Call objects.
   */
  async blockAndAggregate(calls: Call[]) {
    return this.tryBlockAndAggregate(true, calls);
  }

  /**
   * Aggregates calls allowing individual failures via allowFailure flag.
   * Mirrors: function aggregate3(Call3[] calldata calls)
   * @param calls - Array of Call3 objects.
   * @returns Array of tuples [success, decodedResult or raw hex].
   */
  async aggregate3(calls: Call3[]): Promise<Array<[boolean, any]>> {
    const payload = calls.map(
      ({ contract, functionFragment, args, allowFailure }) => ({
        target: contract.target,
        allowFailure,
        callData: contract.interface.encodeFunctionData(functionFragment, args),
      })
    );

    const [rawResults] = await this.rpcCall<[MulticallResult[]]>("aggregate3", [
      payload,
    ]);

    return rawResults.map((r, i) => {
      if (!r.success) return [false, r.returnData] as [boolean, any];
      try {
        // decodeFunctionResult gives us a Result proxy
        const decoded = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );

        // If function has a *single* output, decoded.length === 1
        const raw =
          decoded.length === 1
            ? decoded[0]
            : // multiple outputs → toArray() gives [v0, v1, ...]
              decoded.toArray(true);

        // Now: if raw is a struct proxy → raw.toObject(true)
        // if raw is an array of struct proxies → raw.map(r => r.toObject(true))
        let plain: any;

        if (isEthersResult(raw)) {
          // single struct → plain object
          plain = raw.toObject(true);
        } else if (
          Array.isArray(raw) &&
          raw.length > 0 &&
          isEthersResult(raw[0])
        ) {
          // array of structs → plain array of objects
          plain = (raw as EthersResult[]).map((r) => r.toObject(true));
        } else {
          // primitives or tuples → already plain
          plain = raw;
        }

        return [true, plain] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  /**
   * Aggregates calls with ETH value, allowing failures per-call.
   * Mirrors: function aggregate3Value(Call3Value[] calldata calls)
   * @param calls - Array of Call3Value objects.
   * @returns Array of tuples [success, decodedResult or raw hex].
   */
  async aggregate3Value(calls: Call3Value[]): Promise<Array<[boolean, any]>> {
    const payload = calls.map(
      ({ contract, functionFragment, args, allowFailure, value }) => ({
        target: contract.target,
        allowFailure,
        value,
        callData: contract.interface.encodeFunctionData(functionFragment, args),
      })
    );

    // Sum all ETH values
    const totalValue = calls.reduce((sum, c) => sum + c.value, 0n);

    const [rawResults] = await this.rpcCall<[MulticallResult[]]>(
      "aggregate3Value",
      [payload],
      totalValue
    );

    return rawResults.map((r, i) => {
      if (!r.success) return [false, r.returnData] as [boolean, any];

      try {
        const dec = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );
        const vals = Array.isArray(dec) ? dec : Object.values(dec);
        return [true, vals.length === 1 ? vals[0] : vals] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  // ==== GETTERS (all return bigint or string) ====

  /**
   * @returns The current block number.
   */
  getBlockNumber(): Promise<bigint> {
    return this.rpcCall<[bigint]>("getBlockNumber", []).then((r) => r[0]);
  }

  /**
   * @param blockNumber - Block number to fetch hash for.
   * @returns The block hash as a hex string.
   */
  getBlockHash(blockNumber: bigint): Promise<string> {
    return this.rpcCall<[string]>("getBlockHash", [blockNumber]).then(
      (r) => r[0]
    );
  }

  /**
   * @returns The hash of the previous block.
   */
  getLastBlockHash(): Promise<string> {
    return this.rpcCall<[string]>("getLastBlockHash", []).then((r) => r[0]);
  }

  /**
   * @returns The current block timestamp.
   */
  getCurrentBlockTimestamp(): Promise<bigint> {
    return this.rpcCall<[bigint]>("getCurrentBlockTimestamp", []).then(
      (r) => r[0]
    );
  }

  /**
   * @returns The current block gas limit.
   */
  getCurrentBlockGasLimit(): Promise<bigint> {
    return this.rpcCall<[bigint]>("getCurrentBlockGasLimit", []).then(
      (r) => r[0]
    );
  }

  /**
   * @returns The coinbase (miner) address of the current block.
   */
  getCurrentBlockCoinbase(): Promise<string> {
    return this.rpcCall<[string]>("getCurrentBlockCoinbase", []).then(
      (r) => r[0]
    );
  }

  /**
   * @param address - Address whose ETH balance to fetch.
   * @returns The ETH balance (in wei) as bigint.
   */
  getEthBalance(address: string): Promise<bigint> {
    return this.rpcCall<[bigint]>("getEthBalance", [address]).then((r) => r[0]);
  }

  /**
   * @returns The base fee of the current block.
   */
  getBasefee(): Promise<bigint> {
    return this.rpcCall<[bigint]>("getBasefee", []).then((r) => r[0]);
  }

  /**
   * @returns The chain ID of the current network.
   */
  getChainId(): Promise<bigint> {
    return this.rpcCall<[bigint]>("getChainId", []).then((r) => r[0]);
  }
}

export default Multicall;
