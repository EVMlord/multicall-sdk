# @evmlord/multicall-sdk

![npm version](https://img.shields.io/npm/v/@evmlord/multicall-sdk)
![License](https://img.shields.io/npm/l/@evmlord/multicall-sdk)
[![All downloads][downloads-img]][downloads-url]
![Weekly downloads](https://img.shields.io/npm/dw/@evmlord/multicall-sdk)
![TypeScript](https://img.shields.io/badge/types-included-blue)
![Bundle size](https://img.shields.io/bundlephobia/min/@evmlord/multicall-sdk)
[![GitHub stars](https://img.shields.io/github/stars/evmlord/multicall-sdk?style=social)](https://github.com/evmlord/multicall-sdk)
[![Issues][issues-img]][issues-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

> A powerful TypeScript / JavaScript SDK for interacting with a deployed [Multicall3](https://github.com/mds1/multicall3) contract via ethers-v6. Batch together on-chain calls into a single `eth_call`, decode results, handle failures, and retrieve block info — all with one simple class.

## Features

- **Batch calls** (`aggregate`, `tryAggregate`, `aggregate3`, `aggregate3Value`, `blockAndAggregate`, `tryBlockAndAggregate`)
- **View helpers**: `getBlockNumber`, `getBlockHash`, `getLastBlockHash`, `getCurrentBlockTimestamp`, `getCurrentBlockGasLimit`, `getCurrentBlockCoinbase`, `getEthBalance`, `getBasefee`, `getChainId`
- **Native `bigint`** return values (no `BigNumber` overhead)
- Fully typed with **TypeScript** (declarations included)
- **Single entry-point**: import all constants, ABIs and types from `@evmlord/multicall-sdk`

---

## Installation

```bash
# via yarn
yarn add @evmlord/multicall-sdk

# or npm
npm install @evmlord/multicall-sdk

```

## Usage

The below networks are supported by default, and custom networks can be supported by providing a deployed Multicall contract address.

<!-- CHAINS-TABLE:START -->
<!-- This section is auto-generated – do not edit -->
<!-- CHAINS-TABLE:END -->

### Constructor

- With `chainId`

```ts
import { ethers } from "ethers";
import {
  Multicall,
  MulticallRawResult,
  Call,
  Call3,
  Call3Value,
  MulticallConstructorArgs,
} from "@evmlord/multicall-sdk";
import erc20Abi from "./abi/erc20.json";

const rpc = "https://your-rpc-here.org/";

// 1) Create an ethers provider (e.g. Infura, Alchemy, JSON-RPC, etc.)
const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth");

const multicall = new Multicall({
  provider // your ethers provider
  chainId: ChainId.MAINNET, // from exported ChainId enum
});
```

- With custom Multicall address

```ts
import { ethers } from "ethers";
import {
  Multicall,
  MulticallRawResult,
  Call,
  Call3,
  Call3Value,
  MulticallConstructorArgs,
} from "@evmlord/multicall-sdk";
import erc20Abi from "./abi/erc20.json";

// 1) Create an ethers provider (e.g. Infura, Alchemy, JSON-RPC, etc.)
const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth");

// 2) Instantiate the SDK
const multicall = new Multicall({
  provider, // your ethers provider
  multicallAddress: "The address of the deployed multicall3 contract", // override default if deployed elsewhere
});
```

### Aggregating

```ts
// 3) Prepare one or more Calls
const token = new ethers.Contract("0x…ERC20", erc20Abi, provider);

const calls: Call[] = [
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress1"] },
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress2"] },
  { contract: token, functionFragment: "balanceOf", args: ["0xYourAddress3"] },
  { contract: token, functionFragment: "totalSupply", args: [] },
];

// 4) Batch them
const { blockNumber, returnData } = await multicall.aggregate(calls);

// returnData is string[] of raw hex
// To decode:
console.log(
  "Balance of Address 1:",
  token.interface.decodeFunctionResult("balanceOf", returnData[0])[0]
);
console.log(
  "Balance of Address 2:",
  token.interface.decodeFunctionResult("balanceOf", returnData[1])[0]
);
console.log(
  "Balance of Address 3:",
  token.interface.decodeFunctionResult("balanceOf", returnData[2])[0]
);
console.log(
  "TotalSupply:",
  token.interface.decodeFunctionResult("totalSupply", returnData[4])[0]
);
console.log("At block:", blockNumber);
```

#### Batch Methods

- `aggregate(calls: Call[])`
  Reverts on any failure.

```ts
const { blockNumber, returnData } = await multicall.aggregate(calls);
```

- `tryAggregate(requireSuccess: boolean, calls: Call[])`

  Continue past failed calls; returns `Array<[success, decodedOrRaw]>`.

- `tryBlockAndAggregate(requireSuccess: boolean, calls: Call[])`

  Like `tryAggregate`, plus returns `{ blockNumber, blockHash, returnData }`.

- `blockAndAggregate(calls: Call[])`

  Alias for `tryBlockAndAggregate(true, calls)`.

- `aggregate3(calls: Call3[])`

  Allow individual failures via `allowFailure` flag on each call.

- `aggregate3Value(calls: Call3Value[])`

  Like `aggregate3`, but each call can send ETH (`value`) and you supply the total `msg.value`.

```ts

// ── aggregate3 example ─────────────────────────────────────────
// call two view methods in one batch, but let one of them fail
const calls3: Call3[] = [
  {
    contract:        token,
    functionFragment:'balanceOf',
    args:            [ user ],
    allowFailure:    true
  },
  {
    contract:        token,
    functionFragment:'nonExistedProperty', // this will throw
    args:            [],
    allowFailure:    true
  }
]

const results3 = await multicall.aggregate3(calls3)
// results3 is Array<[success: boolean, data]>
console.log('balanceOf →', results3[0])
console.log('nonExistedProperty →', results3[1])


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

const results3Value = await multicall.aggregate3Value(calls3Value)
// returns Array<[success: boolean, data]>
console.log('getSomeData →', results3Value[0])
console.log('getOtherData →', results3Value[1])
```

#### What’s happening here?

- `aggregate3`
  You pass `allowFailure: true` on any call that might revert—failed calls return `[false, rawHex]` while successes decode normally.

- `aggregate3Value`
  Each call can carry its own ETH payment (`value`), and the SDK automatically sums them into one `msg.value` for the batch. Any call marked `allowFailure: true` won’t abort the entire batch if it reverts.

### Helper Functions

All return either `Promise<bigint>` or `Promise<string>`:

- `getEthBalance`
  Gets the ETH balance of an address

  ```ts
  const ethBalance = await multicall.getEthBalance("address");
  ```

- `getBlockHash`
  Gets the block hash

  Only works for 256 most recent, excluding current according to [Solidity docs](https://docs.soliditylang.org/en/v0.4.24/units-and-global-variables.html#block-and-transaction-properties)

  ```ts
  const blockHash = await multicall.getBlockHash(blockNumber);
  ```

- `getLastBlockHash`
  Gets the last blocks hash

  ```ts
  const lastBlockHash = await multicall.getLastBlockHash();
  ```

- `getCurrentBlockTimestamp`
  Gets the current block timestamp

  ```ts
  const currentBlockTimestamp = await multicall.getCurrentBlockTimestamp();
  ```

- `getCurrentBlockDifficulty`
  Gets the current block difficulty

  ```ts
  const currentBlockDifficulty = await multicall.getCurrentBlockDifficulty();
  ```

- `getCurrentBlockGasLimit`
  Gets the current block gas limit

  ```ts
  const currentBlockGasLimit = await multicall.getCurrentBlockGasLimit();
  ```

- `getCurrentBlockCoinbase`
  Gets the current block coinbase

  ```ts
  const currentBlockCoinbase = await multicall.getCurrentBlockCoinbase();
  ```

## Testing

This SDK ships with a comprehensive Mocha + Chai + Sinon test suite.

```bash
# run tests
yarn test

```

## Contributing

1. Fork & clone
2. `yarn install`
3. Write code under `src/`
4. Add tests under `test/`
5. Run `yarn test`
6. Submit a PR

## License

MIT License - Copyright (©) 2025 EVMlord

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
