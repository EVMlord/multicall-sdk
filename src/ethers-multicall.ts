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

/**
 * Type-guard for ethers.Result
 * A small “duck-typing” check for anything that looks like an ethers Result.
 * In v6, a `Result` satisfies both of these at runtime:
 */
function isEthersResult(x: any): x is EthersResult {
  return (
    x != null &&
    // Must have a toObject method (used for named structs)
    typeof x.toObject === "function" &&
    // Must have a toArray method (used for unnamed tuples/arrays)
    typeof x.toArray === "function"
  );
}

/**
 * Detect whether `v` is a `Result` proxy for a named struct.
 * (We check for a few heuristics: it has `.toObject` and `.toArray`,
 *  and it also has at least one named key in its internal `#names` array.)
 */
function isStructResult(v: any): v is EthersResult {
  if (!(v instanceof EthersResult)) return false;

  // `Result.getValue(name)` only works if struct fields had names.
  // We can inspect `Object.keys(v)`—if there are any non-integer keys,
  // that’s a sign it’s named. Otherwise, it might be a tuple.
  for (const key of Object.keys(v)) {
    if (isNaN(Number(key))) {
      // found a named key (string that isn’t "0","1","2",…)
      return true;
    }
  }
  return false;
}

/**
 * If `x` is an ethers.Result representing a named struct, return `x.toObject(true)`.
 * If `x` is an array of named struct Results, return `x.map(r => r.toObject(true))`.
 * Otherwise, just return `x` unchanged.
 */
export function unwrapResultProxy(x: any): any {
  // Case A: a single `Result` proxy for a named struct
  if (isStructResult(x)) {
    return (x as EthersResult).toObject(true);
  }

  // Case B: an array—maybe of struct Results or primitives
  if (Array.isArray(x)) {
    // Check if the first element looks like a struct Result
    if (x.length > 0 && isStructResult(x[0])) {
      // Map each element → plain object
      return (x as EthersResult[]).map((r) => r.toObject(true));
    }
    // Otherwise, plain tuple or primitive array—just return it
    return x;
  }

  // Case C: primitive (bigint, string, boolean, etc)
  return x;
}

// /**
//  * Recursively convert ANY ethers.Result (or Proxy of Result) or nested arrays-of-Results
//  * into a **pure** JavaScript primitive / object / array.
//  *
//  * Cases:
//  *   1) A single named‐struct “Result”   → `r.toObject(true)` → plain JS object.
//  *   2) A single unnamed‐tuple “Result”  → `r.toArray(true)`  → nested JS array.
//  *   3) An array of named‐struct Results  → `[ r1, r2, … ].map(r => r.toObject(true))`.
//  *   4) An array of unnamed‐tuple Results → `[ r1, r2, … ].map(r => r.toArray(true))`.
//  *   5) A plain JS array containing primitives or mixed nested Results/arrays → map each element.
//  *   6) Any primitive (string, bigint, boolean, null, undefined, etc) → return as‐is.
//  */
// function _fullyUnwrap(x: any): any {
//   // ────────────────────────────────────────────────────────────────────────────────
//   // 1) “Named struct” → an ethers.Result (or Proxy) that has at least one _non‐numeric_ key
//   //    → return `r.toObject(true)` to deeply unwrap every nested Result inside the struct.
//   // ────────────────────────────────────────────────────────────────────────────────
//   if (isNamedStructResult(x)) {
//     return (x as EthersResult).toObject(/* deep= */ true);
//   }

//   // ────────────────────────────────────────────────────────────────────────────────
//   // 2) “Unnamed tuple” → an ethers.Result (or Proxy) with only numeric indices.
//   //    Could be either:
//   //      • a single tuple (e.g. function foo(): (uint256,address))  OR
//   //      • a tuple[] (e.g. function bar(): (uint256,address)[]).
//   //    To tell the difference, we inspect x.toArray(false) and see if each element is
//   //    itself a struct-result or just a primitive/array.
//   // ────────────────────────────────────────────────────────────────────────────────
//   if (x instanceof EthersResult) {
//     // Convert to a plain JS array, but do not yet deep‐convert its children:
//     const arr = (x as EthersResult).toArray(/* deep= */ false);

//     // If arr[0] is a named‐struct Result, we treat this as “struct[]”:
//     if (
//       arr.length > 0 &&
//       arr[0] instanceof EthersResult &&
//       isNamedStructResult(arr[0])
//     ) {
//       // array of structs → return array of objects
//       return (arr as EthersResult[]).map((r) => r.toObject(/* deep= */ true));
//     }

//     // Otherwise, it’s either:
//     //   • a single unnamed tuple (e.g. [BigNumber, "0xabc…"]),  OR
//     //   • an array of unnamed‐tuples (e.g. [ Result([...]), Result([...]), … ]).
//     // In either case, we want to _fully unwrap_ each element.
//     return arr.map((child) => _fullyUnwrap(child));
//   }

//   // ────────────────────────────────────────────────────────────────────────────────
//   // 3) A plain JS Array that might contain:
//   //       • primitives, or
//   //       • nested ethers.Result (Proxy), or
//   //       • nested arrays of these.
//   //    We must recurse over every element to strip away any leftover Result proxy.
//   // ────────────────────────────────────────────────────────────────────────────────
//   if (Array.isArray(x)) {
//     return (x as any[]).map((child) => _fullyUnwrap(child));
//   }

//   // ────────────────────────────────────────────────────────────────────────────────
//   // 4) A “simple” primitive (string, bigint, number, boolean, null, undefined, etc).
//   //    Nothing left to unwrap—return as‐is.
//   // ────────────────────────────────────────────────────────────────────────────────
//   return x;
// }

// /**
//  * _fullyUnwrap (…) takes ANY of:
//  *   • an ethers.Result (Proxy) for a named struct
//  *   • an ethers.Result for an unnamed tuple
//  *   • an ethers.Result for a tuple[] or struct[]
//  *   • a plain JS Array (which may contain nested Results or arrays)
//  *   • a primitive (string, bigint, number, boolean, null, undefined)
//  *
//  * and recursively returns:
//  *   • a plain JS object       (if it truly was a named struct)
//  *   • a JS array of objects   (if it truly was struct[])
//  *   • a JS array of arrays    (if it truly was tuple[] or nested tuples)
//  *   • a primitive             (if it was already primitive)
//  */
// function _fullyUnwrap(x: any, c?: number[]): any {
//   const cases: number[] = c || [];
//   // 1) If x is an ethers.Result (Proxy or not), try to treat it as a NAMED struct:
//   //    • Calling `toObject(true)` will only succeed if it really has named fields.
//   //    • If it does, we immediately return that plain‐JS object.
//   //
//   if (x instanceof EthersResult) {
//     try {
//       console.log("case 1");

//       // If this was a “named struct” (or array of named structs), toObject(true) will work:
//       const res = x.toObject(/* deep = */ true);
//       cases.push(1);
//       console.log({ cases });
//       return res;
//     } catch (_err) {
//       // Not a named‐struct.  Must be an unnamed tuple or tuple[].
//       // Fall through to the “toArray(…)” logic below.
//       cases.push(99);

//       console.log({ cases });

//       console.log("not a named struct");
//     }

//     //
//     // 2) Now it must be an UNNAMED tuple or an array of tuples (tuple[]).
//     //    We use `toArray(false)` to get a JS array of child Results/primitives:
//     //
//     const arr = (x as EthersResult).toArray(/* deep = */ false);

//     console.log("case 2");

//     cases.push(2);
//     console.log({ cases });

//     // Now each element of arr could be:
//     //   • a struct‐Result (in the case we actually had struct[]), or
//     //   • a primitive, or
//     //   • a nested tuple Result, etc.
//     // So we recurse on each:
//     return arr.map((child) => _fullyUnwrap(child, cases));
//   }

//   //
//   // 3) If x is a plain JS array (Array.isArray(x)===true), it might contain:
//   //      • nested ethers.Result (Proxy), or
//   //      • nested arrays thereof, or
//   //      • primitives.
//   //    We simply recurse into every element:
//   //
//   if (Array.isArray(x)) {
//     console.log("case 3");

//     cases.push(3);
//     console.log({ cases });

//     return x.map((child) => _fullyUnwrap(child, cases));
//   }

//   //
//   // 4) Otherwise x is already a “primitive” (string, bigint, number, boolean, null, undefined, etc.).
//   //    There’s nothing to unwrap further:
//   //
//   console.log("case 4");
//   cases.push(4);
//   console.log({ cases });

//   return x;
// }

/**
 * Recursively “unwrap” anything returned by ethers.decodeFunctionResult (which is either
 *   • an `EthersResult` proxy (for named structs, or tuple/tuple[]), or
 *   • a plain JS array of primitive values, or
 *   • a primitive (string, bigint, number, boolean, etc.)
 *
 * We want to end up with either:
 *   • a plain { ... } object (for a named struct), OR
 *   • a plain Array of primitives/objects, OR
 *   • a plain primitive.
 *
 * NOTE: ethers.Result wants you to call `.toObject(true)` in order to convert a *named* struct
 *       into a plain object with its named fields.  If you call `.toObject(true)` on something
 *       that is *not* a named struct (e.g. it’s a `tuple[]`), ethers will throw, so we catch
 *       that and fall back to `.toArray(false)`, which returns a plain Array of child Results.
 */
export function _fullyUnwrap(x: any, c?: number[]): any {
  // If the caller didn’t supply a `cases` array, create a fresh one:
  const cases: number[] = c || [];

  // 1) Check: is `x` an ethers.Result (possibly a Proxy)?
  if (isEthersResult(x)) {
    try {
      // --- CASE 1: named struct (or named‐struct[]) ---
      // If `x` really is a named struct (or array of named structs),
      // .toObject(true) will succeed:
      const res = x.toObject(/* deep= */ true);
      cases.push(1);
      console.log({ cases });
      return res;
    } catch (_err) {
      // --- CASE 99: unnamed tuple or tuple[] ---
      // It wasn’t a named struct, so treat it as an unnamed tuple or tuple[]:
      const arr = x.toArray(/* deep= */ false);
      cases.push(99);
      console.log({ cases });

      // Recurse into each child, but pass along the same `cases` array:
      return arr.map((child) => _fullyUnwrap(child, cases));
    }
  }

  // 2) If `x` is a plain JS array (Array.isArray(x) === true), we want to
  //    recurse *into* each element. **Do not return `x` outright.**
  if (Array.isArray(x)) {
    cases.push(2);
    console.log({ cases });
    // Recurse on every element, passing down the same `cases` array:
    return x.map((child) => _fullyUnwrap(child, cases));
  }

  // 3) Otherwise `x` is a primitive (string, bigint, number, boolean, etc.).
  //    There’s nothing more to unwrap, so just return it:
  cases.push(3);
  console.log({ cases });
  return x;
}

/**
 * Recursively peel off every ethers.Result (proxy) or any array of Results,
 * returning only plain JS primitives / arrays / objects.
 *
 * Cases we handle:
 *  1) A single named‐struct Result → `result.toObject(true)`.
 *  2) A single unnamed‐tuple Result → `result.toArray(true)`.
 *  3) A JS array whose first element is a named‐struct Result → map each → `toObject(true)`.
 *  4) A JS array whose first element is an unnamed‐tuple Result → map each → `toArray(true)`.
 *  5) A JS array of primitives or nested arrays → return as‐is.
 *  6) A primitive (bigint, string, boolean, etc) → return as‐is.
 */
export function unwrapResultFully(x: any): any {
  // 1) “Single named‐struct Result?” → convert to { fieldName: value, … }
  if (isNamedStructResult(x)) {
    console.log("case 1");

    return (x as EthersResult).toObject(/* deep= */ true);
  }

  // 2) “Single unnamed‐tuple Result?” → convert to [v0, v1, …], deeply unwrapping children
  if (x instanceof EthersResult && !isNamedStructResult(x)) {
    console.log("case 2");

    return (x as EthersResult).toArray(/* deep= */ true);
  }

  // 3) “JS array whose first element is a named‐struct Result?”
  //    e.g. the output was `TokenData[]`, so each `x[i]` has named keys “token”, “name”, etc.
  if (
    Array.isArray(x) &&
    x.length > 0 &&
    x[0] instanceof EthersResult &&
    isNamedStructResult(x[0])
  ) {
    console.log("case 3");

    return (x as EthersResult[]).map((r) => r.toObject(/* deep= */ true));
  }

  // 4) “JS array whose first element is an unnamed‐tuple Result?”
  if (
    Array.isArray(x) &&
    x.length > 0 &&
    x[0] instanceof EthersResult &&
    !isNamedStructResult(x[0])
  ) {
    console.log("case 4");

    return (x as EthersResult[]).map((r) => r.toArray(/* deep= */ true));
  }

  // 5) “Any other plain JS array” might contain nested Results or nested arrays.
  //    → Recurse into each element, just in case.
  if (Array.isArray(x)) {
    return (x as any[]).map((child) => unwrapResultFully(child));
  }

  console.log("case 6");
  // 6) A primitive (bigint / number / string / boolean / null / undefined / etc) → return as‐is.
  return x;
}

/**
 * Detect “named struct” by checking whether an ethers.Result has ANY non-numeric keys.
 * In a named struct, each field has its own name, so `Object.keys(result)` will contain
 * strings like ["token","name","symbol","decimals","owner"] in addition to ["0","1",…].
 *
 * True if `v` is an ethers.Result (or Proxy<Result>) **and** has at least one
 * non‐numeric key, meaning it represents a **named struct** with named fields.
 */
function isNamedStructResult(v: any): v is EthersResult {
  if (!(v instanceof EthersResult)) return false;

  // An ethers.Result with named fields will expose those names as keys.
  // If any key is not a decimal string, we know it is named.
  return Object.keys(v).some((k) => isNaN(Number(k)));
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
   * @returns An array of [success:boolean, data:any].
   *   - If success===true, data is already plain JS:
   *     • primitive (bigint, string, etc)
   *     • tuple → JS array of [v0,v1,…]
   *     • struct → JS object {field1, field2,…}
   *     • struct[] → JS array of objects
   *   - If success===false, data is the raw hex revertData string.
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
      if (!r.success) return [false, r.returnData] as [boolean, any];

      try {
        // decodeFunctionResult gives us a `Result` proxy
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

        // Now we need to “unwrap” rawOutput:
        // • If rawOutput is a named‐struct Result → use .toObject(true)
        // • If rawOutput is an array of struct Results → map each .toObject(true)
        // • Otherwise, leave it alone (primitive/tuple)

        // Now fully unwrap rawOutput into a plain JS primitive/object/array:
        const plain = _fullyUnwrap(rawOutput);

        // const plain = unwrapResultProxy(rawOutput);

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
