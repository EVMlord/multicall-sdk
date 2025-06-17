# @evmlord/multicall-sdk – Batch smart-contract calls on Ethereum & EVM networks

A lightweight TypeScript/JavaScript library built on **ethers v6** for DeFi dashboards, on-chain analytics and gas-optimised dApps.

![npm @evmlord/multicall-sdk latest version](https://img.shields.io/npm/v/@evmlord/multicall-sdk)
![MIT license for @evmlord/multicall-sdk](https://img.shields.io/npm/l/@evmlord/multicall-sdk)
[![All npm downloads for @evmlord/multicall-sdk][downloads-img]][downloads-url]
![Weekly npm downloads for @evmlord/multicall-sdk](https://img.shields.io/npm/dw/@evmlord/multicall-sdk)
![TypeScript types included](https://img.shields.io/badge/types-included-blue)
![Minified bundle size](https://img.shields.io/bundlephobia/min/@evmlord/multicall-sdk)
[![GitHub stars](https://img.shields.io/github/stars/evmlord/multicall-sdk?style=social)](https://github.com/evmlord/multicall-sdk)
[![GitHub Issues][issues-img]][issues-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

<!-- toc -->
- [@evmlord/multicall-sdk – Batch smart-contract calls on Ethereum & EVM networks](#evmlordmulticall-sdk-batch-smart-contract-calls-on-ethereum-evm-networks)
  - [🚀 Why @evmlord/multicall-sdk?](#-why-evmlordmulticall-sdk)
  - [🔧 Installation (Node .js / TypeScript)](#-installation-node-js-typescript)
  - [📖 Quick-Start Example with ethers v6](#-quick-start-example-with-ethers-v6)
    - [1. Create your Multicall client](#1-create-your-multicall-client)
    - [2. Batch simple eth_calls](#2-batch-simple-eth_calls)
  - [⚙️ API Reference](#-api-reference)
    - [Batch Methods](#batch-methods)
      - [What’s happening here?](#whats-happening-here)
      - [Sending State-Changing Multicall Transactions](#sending-state-changing-multicall-transactions)
        - [API](#api)
    - [Helper Functions](#helper-functions)
  - [🧪 Testing](#-testing)
  - [🤝 Contributing](#-contributing)
  - [📜 LICENSE](#-license)

<!-- tocstop -->

---

## 🚀 Why @evmlord/multicall-sdk?

- **Gas & RPC Optimized**  
  Combine dozens of `eth_call` into one multicall, slashing HTTP/WebSocket overhead and minimizing latency.

- **Fully Typed**  
  Written in TypeScript with built-in declarations—autocomplete your batch calls, interfaces, and return values.

- **Failure-Tolerant**  
  Gracefully handle individual call failures (`allowFailure`) without aborting the entire batch.

- **Rich Decoding**  
  Automatically unpack tuples, structs, arrays and custom errors into plain JS objects & arrays—no manual unpacking.

- **EVM & DeFi Focused**  
  Supports **Multicall3**, **Multicall2** and on-chain block helpers (`getBlockNumber`, `getEthBalance`, etc.) across **280+** networks.

---

## 🔧 Installation (Node .js / TypeScript)

```bash
# via yarn
yarn add @evmlord/multicall-sdk

# or npm
npm install @evmlord/multicall-sdk

```

## 📖 Quick-Start Example with ethers v6

**<!-- CHAINS-COUNT -->285<!-- CHAINS-COUNT -->** EVM-compatible networks are supported by default, and custom networks can be supported by providing a deployed Multicall contract address.

👉 See the complete list in [`SUPPORTED_NETWORKS.md`](./SUPPORTED_NETWORKS.md).

### 1. Create your Multicall client

```ts
import { JsonRpcProvider, WebSocketProvider } from "ethers";
import { Multicall } from "@evmlord/multicall-sdk";

// 1) HTTP RPC URL
const mc1 = new Multicall({
  provider: "https://mainnet.infura.io/v3/…",
  chainId: 1,
});

// 2) Browser/EIP-1193 (e.g. MetaMask)
const mc2 = new Multicall({
  provider: window.ethereum, // auto-wrapped
  multicallAddress: "0x…", // override default if deployed elsewhere
});

// 3) Already-constructed ethers Provider
const ws = new WebSocketProvider("wss://…");
const mc3 = new Multicall({ provider: ws, chainId: 5 });

// 4) Custom signer for writing txs
const signer = wallet.connect(provider);
const mc4 = new Multicall({
  provider: provider,
  signer: signer,
  chainId: 56,
});
```

### 2. Batch simple eth_calls

```ts
import erc20Abi from "./abi/ERC20.json";
import { Call } from "@evmlord/multicall-abi";

const token = new ethers.Contract("0x…ERC20", erc20Abi, provider);

// Prepare calls
const calls: Call[] = [
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress1"] },
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress2"] },
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress3"] },
  { contract: token, functionFragment: "totalSupply", args: [] },
];

// Execute a single eth_call via Multicall
const { blockNumber, returnData } = await mc1.aggregate(calls);

// Decode your results
const [balance1] = token.interface.decodeFunctionResult(
  "balanceOf",
  returnData[0]
);
const [balance2] = token.interface.decodeFunctionResult(
  "balanceOf",
  returnData[1]
);
const [balance3] = token.interface.decodeFunctionResult(
  "balanceOf",
  returnData[2]
);
const [supply] = token.interface.decodeFunctionResult(
  "totalSupply",
  returnData[3]
);

console.log({
  blockNumber,
  balance1,
  balance2,
  balance3,
  supply,
});

/* 
 console:
{
  blockNumber: 55038412n,
  balance1: 76950775000000000000000n,
  balance2: 0n,
  balance3: 1583902570428472973924450219389n,
  supply: 10000000000000000000000000000000000000000000n
} 
*/
```

---

## ⚙️ API Reference

### Batch Methods

| Method                                                           | Description                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aggregate(calls: Call[])`                                       | Reverts on **any** failing call. Returns <br>`{ blockNumber, returnData: string[] }`.                                                                                            |
| `tryAggregate(requireSuccess, calls: Call[])`                    | Optionally continue on failed calls. Returns <br>`Array<{ success: boolean, returnData: string }>`                                                                               |
| `blockAndAggregate(calls: Call[])`                               | Alias for `tryBlockAndAggregate(true, calls)`. Returns <br>`{ blockNumber, blockHash, returnData }`.                                                                             |
| `tryBlockAndAggregate(requireSuccess, calls: Call[])`            | Same as `tryAggregate` but also provides full block info plus per-call success flags.                                                                                            |
| `aggregate3(calls: Call3[])`                                     | Multicall 3 style: each call has an `allowFailure` flag, and return values are auto-decoded to JS tuples/structs.                                                                |
| `aggregate3Value(calls: Call3Value[])`                           | Like `aggregate3`, but supports per-call native ETH **value** and automatically sums `msg.value`.                                                                                |
| `sendAggregate3Value(calls: Call3Value[], overrides: Overrides)` | Like `aggregate3Value`, but for real on-chain writes, accepts optional Ethers overrides (gasLimit, gasPrice, etc) and returns `TransactionResponse`, which you can `.wait()` on. |

```ts

// ── aggregate3 example ─────────────────────────────────────────
// call two view methods in one batch, but let one of them fail
const calls3: Call3[] = [
    {
      contract: token,
      functionFragment: "nonExistedProperty", // this will throw
      args: [],
      allowFailure: true,
    },
    {
      contract: token,
      functionFragment: "balanceOf",
      args: ["0x5500..."], // wallet address here
      allowFailure: true,
    },
  ];

  const results3 = await mc1.aggregate3(calls3);

  console.log({ results3 });

  /*
console:
{
  results3: [
    [ false, 'Revert: (unrecognized revert: 0x…)' ],
    [ true, 76950775000000000000000n ]
  ]
}
 */

// ── aggregate3Value example ────────────────────────────────────
// imagine a payable helper that charges a small fee per call
const helper = new ethers.Contract(
  "0x…EHelperContract",   // your helper address
  HelperABI,                 //  your ABI
  provider
)

// send 0.001 ETH with each call to fetch some on-chain data
const fee  = 0.001n * 10n**18n  // 0.001 ETH in wei as bigint
const calls3Value: Call3Value[] = [
  {
    contract:        helper,
    functionFragment:'getSomeData',
    args:            [ user ],
    allowFailure:    false,
    value:           fee
  },
  {
    contract:        helper,
    functionFragment:'getOtherData',
    args:            [ user, 42 ],
    allowFailure:    true,
    value:           fee
  }
]

const results3Value = await mc1.aggregate3Value(calls3Value)
// returns Array<[success: boolean, data]>
{
  const [ok, getSomeData] = results3Value[0];
  if (ok) {
  console.log('getSomeData →', getSomeData)
  }

}
 {
    const [ok, getOtherData] = results3Value[1];
    if (ok) {
      console.log('getOtherData →', getOtherData)
    }
  }

```

#### What’s happening here?

- `aggregate3`
  You pass `allowFailure: true` on any call that might revert—failed calls return `[false, rawHex]` while successes decode normally.

- `aggregate3Value`
  Each call can carry its own ETH payment (`value`), and the SDK automatically sums them into one `msg.value` for the batch. Any call marked `allowFailure: true` won’t abort the entire batch if it reverts.

#### Sending State-Changing Multicall Transactions

Up until now we’ve only covered the “view” methods (`aggregate`, `tryAggregate`, `aggregate3`, etc). If you need to batch together **state-changing** calls (optionally with ETH attached) into a **single on-chain tx**, you can use `sendAggregate3Value`:

```ts
import { Multicall, Call3Value, ChainId } from "@evmlord/multicall-sdk";
import { ethers } from "ethers";

// 1) Create a signer-backed Multicall instance
const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const multicall = new Multicall({
  provider,
  chainId: ChainId.MAINNET,
  signer: wallet, // <- needed for txs
});

// 2) Prepare your payable calls
//    each call3Value: { contract, functionFragment, args, allowFailure, value }
const fee = ethers.parseUnits("0.001", "ether"); // per-call ETH fee
const myHelper = new ethers.Contract("0xHelper…", HelperABI, provider);

const calls: Call3Value[] = [
  {
    contract: myHelper,
    functionFragment: "depositAndFetch",
    args: ["0xYourAddress"],
    allowFailure: false,
    value: fee,
  },
  {
    contract: myHelper,
    functionFragment: "updateRecord",
    args: [42, "hello"],
    allowFailure: true,
    value: fee,
  },
  // …etc
];

// 3) Send them all in one tx
const tx = await mc1.sendAggregate3Value(calls, {
  gasLimit: 1_200_000,
});
console.log("Multicall tx hash:", tx.hash);

// 4) Wait for it to be mined
const receipt = await tx.wait();
console.log("→ mined in block", receipt.blockNumber);
```

##### API

```ts
/**
 * Batch-execute multiple non-view calls (each may carry its own ETH value)
 * in a single on-chain TX via Multicall3.aggregate3Value.
 *
 * @param calls     – Array of { contract, functionFragment, args, allowFailure, value }
 * @param overrides – Ethers transaction overrides (gasLimit, maxPriorityFeePerGas, etc)
 * @returns          Promise<TransactionResponse>
 * @throws if no Signer was provided in the constructor.
 */
sendAggregate3Value(
  calls: Call3Value[],
  overrides?: Overrides
): Promise<TransactionResponse>;
```

- `allowFailure: true` on any `Call3Value` lets that individual call revert without failing the entire batch.

- The SDK automatically sums up all `value` fields into one `msg.value` on the multicall.

### Helper Functions

All return either `Promise<bigint>` or `Promise<string>`:

- `getEthBalance`
  Gets the ETH balance of an address

  ```ts
  const ethBalance = await mc1.getEthBalance("address");
  ```

- `getBlockHash`
  Gets the block hash

  Only works for 256 most recent, excluding current according to [Solidity docs](https://docs.soliditylang.org/en/v0.4.24/units-and-global-variables.html#block-and-transaction-properties)

  ```ts
  const blockHash = await mc1.getBlockHash(blockNumber);
  ```

- `getLastBlockHash`
  Gets the last blocks hash

  ```ts
  const lastBlockHash = await mc1.getLastBlockHash();
  ```

- `getCurrentBlockTimestamp`
  Gets the current block timestamp

  ```ts
  const currentBlockTimestamp = await mc1.getCurrentBlockTimestamp();
  ```

- `getCurrentBlockDifficulty`
  Gets the current block difficulty

  ```ts
  const currentBlockDifficulty = await mc1.getCurrentBlockDifficulty();
  ```

- `getCurrentBlockGasLimit`
  Gets the current block gas limit

  ```ts
  const currentBlockGasLimit = await mc1.getCurrentBlockGasLimit();
  ```

- `getCurrentBlockCoinbase`
  Gets the current block coinbase

  ```ts
  const currentBlockCoinbase = await mc1.getCurrentBlockCoinbase();
  ```

## 🧪 Testing

This SDK ships with a comprehensive Mocha + Chai + Sinon test suite.

```bash
# Run unit tests (Mocha + Chai + Sinon)
yarn test

```

## 🤝 Contributing

1. Fork & clone
2. `yarn install`
3. Develop in `src/`, add tests in `test/`
4. Run `yarn test` & Submit a PR

## 📜 LICENSE

Released under the MIT License.

© 2025 EVMlord

[build-img]: https://github.com/evmlord/multicall-sdk/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/evmlord/multicall-sdk/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/@evmlord/multicall-sdk
[downloads-url]: https://www.npmtrends.com/@evmlord/multicall-sdk
[issues-img]: https://img.shields.io/github/issues/evmlord/multicall-sdk
[issues-url]: https://github.com/evmlord/multicall-sdk/issues
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/

<!-- [![Build Status][build-img]][build-url] -->
<!-- Keywords: Ethereum Multicall, EVM batch calls, ethers v6 sdk, solidity multicall library -->
