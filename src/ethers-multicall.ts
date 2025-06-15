import {
  Provider,
  Interface,
  TransactionResponse,
  Overrides,
  Contract,
} from "ethers";
import { addresses } from "./constants";
import { Multicall3ABI } from "./ABIs";
import type {
  Call,
  Call3,
  Call3Value,
  ConstructorArgs,
  MulticallResult,
} from "./types";
import { _fullyUnwrap, decodeRevert } from "./helpers";

/**
 * Multicall wraps the Multicall3 Solidity contract for batching on-chain calls.
 * Read-only methods use a low-level `rpcCall` to save the overhead of a full tx.
 * State-changing methods go through an ethers `Contract` and require a signer.
 */
class Multicall {
  public readonly provider: Provider;
  public readonly target: string;
  public readonly iface: Interface;
  public readonly contract?: Contract;

  /**
   * @param args.provider         Ethers Provider instance
   * @param args.signer           Optional Signer for sending txs
   * @param args.chainId          If you omit multicallAddress, must supply chainId
   * @param args.multicallAddress Explicit Multicall3 address (overrides chainId)
   * @throws if no multicall contract address is found
   */
  constructor({
    provider,
    chainId,
    multicallAddress,
    signer,
  }: ConstructorArgs) {
    const address =
      multicallAddress ?? (chainId ? addresses.Multicall[chainId] : undefined);

    if (!address) {
      throw new Error(
        `No multicall address found for chainId ${chainId}; please pass multicallAddress`
      );
    }

    this.target = address;

    this.provider = provider;

    this.iface = new Interface(Multicall3ABI);

    // for stateful calls:
    if (signer) this.contract = new Contract(address, this.iface, signer);
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
    const decoded = this.iface.decodeFunctionResult(method, raw);
    return decoded as unknown as T;
  }

  /**
   * Execute a batch of calls in a single RPC request, reverting the entire batch
   * if any individual call fails.  Mirrors the on-chain signature:
   *   `function aggregate(Call[] calldata calls) returns (uint256 blockNumber, bytes[] returnData)`
   *
   * @param calls
   *   An array of Call descriptors:
   *   - `contract`: an ethers Contract (or equivalent) with `.target` & `.interface`
   *   - `functionFragment`: the ABI name or Fragment of the function to call
   *   - `args`: the arguments for that function
   *
   * @returns
   *   A Promise resolving to an object:
   *   - `blockNumber: bigint` — the block in which the calls were executed
   *   - `returnData: string[]` — an array of raw hex return data, in the same order as `calls`
   *
   * @remarks
   * Since `aggregate` reverts the entire batch if *any* call fails, you must wrap
   * in a try/catch to handle on-chain reverts and decode each entry in `returnData`.
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
   * Execute a batch of calls in a single RPC request, optionally reverting
   * the entire batch if any call fails.  Mirrors the on-chain signature:
   *   `function tryAggregate(bool requireSuccess, Call[] calldata calls)`
   *
   * @param requireSuccess
   *   If `true`, any single call failure will cause the entire batch to revert.
   *   If `false`, failures are returned per-call in the results array.
   *
   * @param calls
   *   An array of Call descriptors:
   *   - `contract`: an ethers Contract (or equivalent) with `.target` & `.interface`
   *   - `functionFragment`: the ABI name/signature of the function to call
   *   - `args`: the arguments for that function
   *
   * @returns
   *   A Promise resolving to an array of tuples `[success: boolean, data: any]`,
   *   in the same order as `calls`:
   *   - If `success === true`, `data` is already plain JS:
   *       • primitive (`bigint`, `string`, etc)
   *       • tuple → `Array<…>`
   *       • struct → `{ field1, field2, … }`
   *       • struct[] → `Array<{…}>`
   *   - If `success === false`, `data` is a human-readable revert string:
   *       “Revert: <reason>” for known errors, or
   *       “(unrecognized revert: 0x…)" snippet for unknown cases.
   */
  async tryAggregate(
    requireSuccess: boolean,
    calls: Call[]
  ): Promise<Array<[boolean, any]>> {
    // Build the call payload
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
      if (!r.success)
        // Decode revert data into a human-readable message
        return [
          false,
          `Revert: ${decodeRevert(
            /* err= */ {},
            /* data= */ r.returnData,
            calls[i].contract.interface
          )}`,
        ] as [boolean, any];

      try {
        // Decode the returned bytes into an ethers.Result proxy
        const decoded = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );

        // If function has a *single* output, decoded.length === 1
        const rawOutput =
          decoded.length === 1
            ? decoded[0]
            : // multiple outputs → toArray() gives [v0, v1, ...]
              decoded.toArray(true);

        // Now fully unwrap rawOutput into a plain JS primitive/object/array:
        const plain = _fullyUnwrap(rawOutput);

        return [true, plain] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  /**
   * Execute a batch of read-only calls at the current block, returning block metadata
   * and per-call success/data tuples.  Backwards-compatible with Multicall2.
   *
   * Mirrors the on-chain signature:
   *   `function tryBlockAndAggregate(bool requireSuccess, Call[] calldata calls)`
   *
   * @param requireSuccess
   *   If `true`, the entire batch will revert if *any* call fails;
   *   if `false`, failures are returned per-call in the results array.
   *
   * @param calls
   *   An array of Call descriptors:
   *   - `contract`: an ethers Contract or equivalent with `.target` & `.interface`
   *   - `functionFragment`: the name/signature of the function to call
   *   - `args`: the arguments for that function
   *
   * @returns
   *   A Promise resolving to an object:
   *   - `blockNumber: bigint` — the block in which the calls were executed
   *   - `blockHash: string` — hash of that block
   *   - `returnData: Array<[success: boolean, data: any]>` — same order as `calls`
   *     • If `success === true`, `data` is plain JS:
   *         – primitive (`bigint`, `string`, etc)
   *         – tuple → `Array<…>`
   *         – struct → `{ field1, field2, … }`
   *         – struct[] → `Array<{…}>`
   *     • If `success === false`, `data` is a human-readable revert:
   *         – `"Revert: <reason>"` for standard and custom errors
   *         – `"(unrecognized revert: 0x…)"` snippet for unknown cases
   */
  async tryBlockAndAggregate(
    requireSuccess: boolean,
    calls: Call[]
  ): Promise<{
    blockNumber: bigint;
    blockHash: string;
    returnData: Array<[boolean, any]>;
  }> {
    // Build the payload
    const payload = calls.map(({ contract, functionFragment, args }) => ({
      target: contract.target,
      callData: contract.interface.encodeFunctionData(functionFragment, args),
    }));

    // Solidity returns (uint256, bytes32, Result[]), so decodeFunctionResult gives [bigint, string, MulticallResult[]]
    const [blockNumber, blockHash, rawResults] = await this.rpcCall<
      [bigint, string, MulticallResult[]]
    >("tryBlockAndAggregate", [requireSuccess, payload]);

    const decoded = rawResults.map((r, i) => {
      if (!r.success)
        // Decode revert data into a readable string
        return [
          false,
          `Revert: ${decodeRevert(
            /* err= */ {},
            /* data= */ r.returnData,
            calls[i].contract.interface
          )}`,
        ] as [boolean, any];

      try {
        // Decode the bytes into an ethers.Result proxy
        const decodedResult = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );

        // If function has a *single* output, decoded.length === 1
        const rawOutput =
          decodedResult.length === 1
            ? decodedResult[0]
            : // multiple outputs → toArray() gives [v0, v1, ...]
              decodedResult.toArray(true);

        // Now fully unwrap rawOutput into a plain JS primitive/object/array:
        const plain = _fullyUnwrap(rawOutput);

        return [true, plain] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });

    return { blockNumber, blockHash, returnData: decoded };
  }

  /**
   * Executes a batch of calls in a single RPC, reverting the entire batch on any failure.
   * Internally this is just `tryBlockAndAggregate(true, calls)`.
   *
   * @param calls - Array of Call objects (each with a contract, functionFragment, and args).
   * @returns A promise resolving to an object:
   *   - `blockNumber: bigint` – the block where these calls were executed
   *   - `blockHash: string`  – the hash of that block
   *   - `returnData: Array<[boolean, any]>` – for each call:
   *       • success=true  ⇒ `any` is the fully‐decoded, plain-JS result (primitive, array, or object)
   *       • success=false ⇒ `any` is the raw revert data hex (the batch will actually have reverted)
   */
  async blockAndAggregate(calls: Call[]): Promise<{
    blockNumber: bigint;
    blockHash: string;
    returnData: Array<[boolean, any]>;
  }> {
    return this.tryBlockAndAggregate(true, calls);
  }

  /**
   * Execute a batch of calls via Multicall3, allowing individual calls to fail.
   *
   * Mirrors the on-chain signature:
   *   `function aggregate3(Call3[] calldata calls)`
   *
   * @param calls
   *   An array of Call3 descriptors:
   *   - `contract`: an ethers Contract or equivalent with `.target` & `.interface`
   *   - `functionFragment`: the name/signature of the function to call
   *   - `args`: the arguments for that function
   *   - `allowFailure`: whether this call may fail without bubbling up
   *
   * @returns
   *   A Promise resolving to an array of `[success, data]` tuples, in the same order:
   *   - If `success === true`, `data` is already a plain‐JS value:
   *       • **primitive** (`bigint`, `string`, `boolean`, etc)
   *       • **tuple** → `Array<…>`
   *       • **struct** → `{ field1:…, field2:…, … }`
   *       • **struct[]** → `Array<{…}>`
   *   - If `success === false`, `data` is a human-readable revert string, prefixed with `"Revert: "`:
   *       • Standard `Error(string)` reasons
   *       • Custom Solidity errors (`MyError(arg1,arg2)`)
   *       • Fallback snippet `(unrecognized revert: 0x…)`
   */
  async aggregate3(calls: Call3[]): Promise<Array<[boolean, any]>> {
    // Build the multicall payload
    const payload = calls.map(
      ({ contract, functionFragment, args, allowFailure }) => ({
        target: contract.target,
        allowFailure,
        callData: contract.interface.encodeFunctionData(functionFragment, args),
      })
    );

    // Execute the RPC
    const [rawResults] = await this.rpcCall<[MulticallResult[]]>("aggregate3", [
      payload,
    ]);

    // Decode + unwrap each return
    return rawResults.map((r, i) => {
      if (!r.success)
        // on failure, try to unpack the revert
        return [
          false,
          `Revert: ${decodeRevert(
            /* err= */ {},
            /* data= */ r.returnData,
            calls[i].contract.interface
          )}`,
        ] as [boolean, any];

      try {
        // decodeFunctionResult gives us an ethers `Result` proxy
        const decoded = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );

        // If function has a *single* output, decoded.length === 1
        const rawOutput =
          decoded.length === 1
            ? decoded[0]
            : // multiple outputs → deep array → toArray() gives [v0, v1, ...]
              decoded.toArray(true);

        // Now fully unwrap rawOutput into a plain JS primitive/object/array:
        const plain = _fullyUnwrap(rawOutput);

        return [true, plain] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  /**
   * Execute a batch of calls (with ETH attached) via Multicall3, allowing individual calls to fail.
   *
   * Mirrors the on-chain signature:
   *   `function aggregate3Value(Call3Value[] calldata calls)`
   *
   * @param calls
   *   An array of Call3Value descriptors:
   *   - `contract`: an ethers Contract or equivalent with `.target` & `.interface`
   *   - `functionFragment`: the name/signature of the function to call
   *   - `args`: the arguments for that function
   *   - `value`: the amount of native ETH (in wei) to send with that call
   *   - `allowFailure`: whether this call may fail without bubbling up
   *
   * @returns
   *   A Promise resolving to an array of `[success, data]` tuples, in the same order:
   *   - If `success === true`, `data` is already a plain‐JS value:
   *       • **primitive** (`bigint`, `string`, `boolean`, etc)
   *       • **tuple** → `Array<…>`
   *       • **struct** → `{ field1:…, field2:…, … }`
   *       • **struct[]** → `Array<{…}>`
   *   - If `success === false`, `data` is a human-readable revert string, prefixed with `"Revert: "`:
   *       • Standard `Error(string)` reasons
   *       • Custom Solidity errors (`MyError(arg1,arg2)`)
   *       • Fallback snippet `(unrecognized revert: 0x…)`
   */
  async aggregate3Value(calls: Call3Value[]): Promise<Array<[boolean, any]>> {
    // Build the multicall3Value payload
    const payload = calls.map(
      ({ contract, functionFragment, args, allowFailure, value }) => ({
        target: contract.target,
        allowFailure,
        value,
        callData: contract.interface.encodeFunctionData(functionFragment, args),
      })
    );

    // Sum up all ETH values to send with the aggregate call
    const totalValue = calls.reduce((sum, c) => sum + c.value, 0n);

    // Execute the RPC, passing along the bundled value
    const [rawResults] = await this.rpcCall<[MulticallResult[]]>(
      "aggregate3Value",
      [payload],
      totalValue
    );

    return rawResults.map((r, i) => {
      if (!r.success)
        // on failure, try to unpack the revert
        return [
          false,
          `Revert: ${decodeRevert(
            /* err= */ {},
            /* data= */ r.returnData,
            calls[i].contract.interface
          )}`,
        ] as [boolean, any];

      try {
        const decoded = calls[i].contract.interface.decodeFunctionResult(
          calls[i].functionFragment,
          r.returnData
        );

        // If function has a *single* output, decoded.length === 1
        const rawOutput =
          decoded.length === 1
            ? decoded[0]
            : // multiple outputs → toArray() gives [v0, v1, ...]
              decoded.toArray(true);

        // Now fully unwrap rawOutput into a plain JS primitive/object/array:
        const plain = _fullyUnwrap(rawOutput);

        return [true, plain] as [boolean, any];
      } catch (err: any) {
        return [false, `Data handling error: ${err.message}`] as [boolean, any];
      }
    });
  }

  /**
   * Batch-execute multiple non-view calls (with optional per-call ETH),
   * in **one payable on-chain tx** via Multicall3.aggregate3Value.
   *
   * @param calls     Each Call3Value describes
   *                  { contract, functionFragment, args, value, allowFailure }
   *                  – the `value` will be added into total `msg.value`.
   * @param overrides Optional Ethers overrides (gasLimit, gasPrice, etc).
   * @returns A Promise resolving to the TransactionResponse, which you can `.wait()` on
   * @throws if no Signer was provided in the constructor.
   */
  async sendAggregate3Value(
    calls: Call3Value[],
    overrides: Overrides = {}
  ): Promise<TransactionResponse> {
    if (!this.contract) {
      throw new Error("Must initialize with signer to send transactions");
    }

    // // [payloadArray, sumOfAllValues] in one go
    // const [payload, totalValue] = calls.reduce<
    //   [
    //     {
    //       target: string;
    //       allowFailure: boolean;
    //       callData: string;
    //     }[],
    //     bigint
    //   ]
    // >(
    //   (
    //     [acc, sum],
    //     { contract, functionFragment, args, allowFailure, value }
    //   ) => [
    //     acc.concat({
    //       target: contract.target.toString(),
    //       allowFailure,
    //       // we don't include per‐call value here—only msg.value matters on-chain:
    //       callData: contract.interface.encodeFunctionData(
    //         functionFragment,
    //         args
    //       ),
    //     }),
    //     sum + value,
    //   ],
    //   [[], 0n]
    // );
    // But readability over terseness

    // Build the multicall3Value payload
    const payload = calls.map(
      ({ contract, functionFragment, args, allowFailure, value }) => ({
        target: contract.target,
        allowFailure,
        value,
        callData: contract.interface.encodeFunctionData(functionFragment, args),
      })
    );

    // Sum up all ETH values to send with the aggregate call
    const totalValue = calls.reduce((sum, c) => sum + c.value, 0n);

    // `aggregate3Value` takes (Call3Value[] calldata calls)
    return this.contract.aggregate3Value(payload, {
      ...overrides,
      value: overrides.value ?? totalValue,
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
