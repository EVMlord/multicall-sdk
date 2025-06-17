# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

## [1.0.0] – 2025-06-16 ↠ **Latest**

### ✨ Added

- **Human-readable revert reasons**

  All failed calls that bubble up from `tryAggregate`, `aggregate3`, `aggregate3Value`, `tryBlockAndAggregate`, and `blockAndAggregate` are routed through the new `decodeRevert()` helper.

  - Standard `Error(string)` messages are ABI-decoded.
  - Custom Solidity errors are parsed via `Interface.parseError()`.
  - A short hex snippet is shown as a fallback.  
    → Consumers now see messages like `Revert: MyError(arg1,arg2)` instead of raw `0xdeadbeef...` blobs.

- **State-changing multicall**

  New `sendAggregate3Value(calls, overrides)` batches **payable** calls into a single on-chain transaction via `Multicall3.aggregate3Value`.

  - All `value` fields are auto-summed (or can be overridden).
  - Requires a `signer` in the `Multicall` constructor.

- **Flexible provider input**

  The `Multicall` constructor now accepts:  
  `string` RPC URL → auto-wrapped in `JsonRpcProvider`  
  EIP-1193 object (e.g. `window.ethereum`) → `BrowserProvider`  
  Any built-in ethers transport (`JsonRpcProvider`, `WebSocketProvider`, `IpcSocketProvider`, …)  
  Any `ethers.Provider` instance

  > Makes the SDK drop-in for browser dapps, Node scripts, or custom transports.

- **Hundreds of new networks**

  Added Multicall addresses for Polygon, Avalanche, Base, ZkSync Era, Scroll, APE Chain, Cronos, and many more. Currently supporting **285** chains.

### 🛠 Improvements

- **Constructor clarity**
  - Accepts `{ provider, optional signer, optional chainId, optional multicallAddress }`.
  - Expanded JSDoc with clear examples of every provider type (HTTP URL, MetaMask, ethers provider, …).
  - Clear error `"Unsupported provider type"` on invalid input.
- **TypeScript / JSDoc polish**  
  Detailed param & return types for all methods.
- **Test suite**  
  Specs updated to expect the new **“Revert: …”** prefix.

### ⚠️ Breaking

- **Strict provider guard**

  Any constructor input that is **not** a supported provider type now throws `Unsupported provider type`.  
  Previously the SDK assumed unknown objects were safe and used them directly.  
  → If you passed a custom shim, wrap it in a valid ethers provider (or EIP-1193 interface) first.

---

<details>

<summary>History (older versions)</summary>

## [0.0.4] – 2025-06-03

- Enhance SDK return types
- Fully unwrap outputs as plain JS primitive/object/array

</details>
