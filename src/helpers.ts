import { AbiCoder, Interface, Result as EthersResult } from "ethers/abi";
import type { Eip1193Provider } from "ethers/providers";
import type { Call } from "./types";

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

export function isEip1193Provider(x: any): x is Eip1193Provider {
  return (
    x != null &&
    // Must have a request method
    "request" in x &&
    typeof x.request === "function"
  );
}

export function validateCall(call: Call): string {
  try {
    return call.contract.interface.encodeFunctionData(
      call.functionFragment,
      call.args
    );
  } catch (e) {
    throw new Error(
      `${decodeRevert(e, undefined, call.contract.interface)} "${
        call.functionFragment
      }" on ${call.contract.target}\n\n`
    );
  }
}

function isPlainObject(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

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
export function _fullyUnwrap(x: any): any {
  // 0) Peel nested "_" shells: { _:{...} } → {...}, repeated
  let v = x;
  while (isPlainObject(v) && "_" in v && Object.keys(v).length === 1) {
    v = v._;
  }

  // 1) Check: is `v` an ethers.Result (possibly a Proxy)?
  if (isEthersResult(v)) {
    try {
      // --- CASE 1: named struct (or named‐struct[]) ---
      // If `v` really is a named struct (or array of named structs),
      // .toObject(true) will succeed:
      return v.toObject(/* deep= */ true);
    } catch (_err) {
      // --- CASE 99: unnamed tuple or tuple[] ---
      // It wasn’t a named struct, so treat it as an unnamed tuple or tuple[]:
      const arr = v.toArray(/* deep= */ false);

      // Recurse into each child, but pass along the same `cases` array:
      return arr.map((child) => _fullyUnwrap(child));
    }
  }

  // 2) If `v` is a plain JS array (Array.isArray(v) === true), we want to
  //    recurse *into* each element. **Do not return `v` outright.**
  if (Array.isArray(v)) {
    // Recurse on every element, passing down the same `cases` array:
    return v.map((child) => _fullyUnwrap(child));
  }

  // 3) Plain object with lingering "_" plus other keys
  if (isPlainObject(v) && "_" in v) {
    const inner = _fullyUnwrap(v._);
    const { _, ...restRaw } = v as any;
    const rest = Object.fromEntries(
      Object.entries(restRaw).map(([k, val]) => [k, _fullyUnwrap(val)])
    );

    // If "_" holds an array, that's already unwrapped; return it.
    if (Array.isArray(inner)) return inner;

    // If "_" holds an object, merge; named fields in `rest` win.
    if (isPlainObject(inner)) return { ...inner, ...rest };

    // "_" holds a primitive: return `rest` if it has anything, else the primitive.
    return Object.keys(rest).length ? rest : inner;
  }

  // 4) Otherwise `v` is a primitive (string, bigint, number, boolean, etc.).
  //    There’s nothing more to unwrap, so just return it:
  return v;
}

/**
 * Turn any thrown/reverted call into a human‐readable string.
 *
 * 1) If Ethers gave us .reason or .shortMessage, use that.
 * 2) Otherwise inspect raw revert data:
 *    • If it’s the standard `Error(string)`, ABI-decode it
 *    • If it’s a Solidity panic, decode the panic code
 *    • Else try `contractIface.parseError(...)` for custom errors
 *    • Fallback to a short hex snippet
 *
 * @param err      The thrown error (from ethers)
 * @param data     Optional raw revert data (e.g. r.returnData in multicall)
 * @param contractIface  The Interface used to encode the call
 */
export function decodeRevert(
  err: any,
  data: string | undefined,
  contractIface: Interface
): string {
  // 1) Ethers-packed reason already?
  if (typeof err?.reason === "string") return err.reason;
  if (typeof err?.shortMessage === "string") return err.shortMessage;

  // 2) Grab raw bytes from .data or multicall returnData
  const raw =
    typeof data === "string"
      ? data
      : typeof err?.data === "string"
      ? err.data
      : typeof err?.receipt?.revertReason === "string"
      ? err.receipt.revertReason
      : undefined;

  if (!raw || !raw.startsWith("0x")) {
    return "(no revert data)";
  }

  // 3) Standard Error(string)? selector = 0x08c379a0
  if (raw.slice(0, 10) === "0x08c379a0") {
    try {
      // strip selector and decode
      const [msg] = AbiCoder.defaultAbiCoder().decode(
        ["string"],
        "0x" + raw.slice(10)
      );
      return String(msg);
    } catch {
      // fall through
    }
  }

  // 3b) Solidity panic()? selector = 0x4e487b71
  if (raw.startsWith("0x4e487b71")) {
    try {
      const [code] = AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        "0x" + raw.slice(10)
      );
      return `Panic(${code.toString()})`;
    } catch {
      /* fall through */
    }
  }

  // 4) Custom errors via parseError
  try {
    const parsed = contractIface.parseError(raw);
    // e.g. { name: "MyError", args: [ ... ] }
    if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
  } catch {
    // fall through
  }

  // 5) give up
  return `(unrecognized revert: ${raw.slice(0, 42)}…)`;
}
