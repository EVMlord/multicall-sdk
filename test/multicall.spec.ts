import { expect } from "chai";
import { assert, createSandbox, match, SinonSandbox, SinonStub } from "sinon";
import { Interface } from "ethers";
import {
  Multicall,
  MulticallRawResult,
  Call,
  Call3,
  Call3Value,
  MulticallConstructorArgs,
} from "../src/index";
import { ChainId } from "../src/constants";
import extendedErc20Abi from "./abi/extended-erc-20.json";

describe("Multicall SDK", () => {
  let provider: { call: SinonStub };
  let sdk: Multicall;
  let erc20Interface: Interface;
  let sandbox: SinonSandbox;
  const DUMMY_ADDR = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    sandbox = createSandbox();

    // Fake provider with a stubbed `call`
    provider = { call: sandbox.stub() };

    const args: MulticallConstructorArgs = {
      chainId: ChainId.XRPLEVM_TESTNET,
      provider: provider as any,
    };

    sdk = new Multicall(args);

    // We'll use this to build encoded function results for the underlying fake contracts
    erc20Interface = new Interface(extendedErc20Abi);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("aggregate()", () => {
    it("forwards raw blockNumber and returnData", async () => {
      const blockNumber = 123n;
      const nameResult = erc20Interface.encodeFunctionResult("name", ["TKN"]);

      // When rpcCall is invoked for "aggregate", resolve with [blockNumber, [nameResult]]
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("aggregate", match.array)
        .resolves([blockNumber, [nameResult]]);

      const fakeContract = {
        address: DUMMY_ADDR,
        interface: erc20Interface,
      } as any;

      const calls: Call[] = [
        { contract: fakeContract, functionFragment: "name", args: [] },
      ];

      const res = await sdk.aggregate(calls);

      expect(res.blockNumber).to.equal(blockNumber);
      expect(res.returnData).to.deep.equal([nameResult]);
    });
  });

  describe("tryAggregate()", () => {
    it("decodes successful calls", async () => {
      // Properly encoded return values:
      const nameData = erc20Interface.encodeFunctionResult("name", ["ABC"]);
      const approveData = erc20Interface.encodeFunctionResult("approve", [
        true,
      ]);

      const rawResults: MulticallRawResult[] = [
        { success: true, returnData: nameData },
        { success: true, returnData: approveData },
      ];

      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("tryAggregate", match.array)
        .resolves([rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call[] = [
        { contract: fake, functionFragment: "name", args: [] },
        {
          contract: fake,
          functionFragment: "approve",
          args: [DUMMY_ADDR, 500n],
        },
      ];

      const out = await sdk.tryAggregate(false, calls);

      expect(out[0]).to.deep.equal([true, "ABC"]);
      expect(out[1]).to.deep.equal([true, true]);
    });

    it("propagates failures raw", async () => {
      const rawResults: MulticallRawResult[] = [
        { success: false, returnData: "0xdeadbeef" },
      ];

      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("tryAggregate", match.array)
        .resolves([rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call[] = [
        { contract: fake, functionFragment: "balanceOf", args: [DUMMY_ADDR] },
      ];

      const out = await sdk.tryAggregate(true, calls);

      expect(out).to.deep.equal([[false, "0xdeadbeef"]]);
    });

    it("catches decode errors", async () => {
      // a bad hex that decodeFunctionResult will reject on
      const badHex = "0x1234";
      const rawResults: MulticallRawResult[] = [
        { success: true, returnData: badHex },
      ];

      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("tryAggregate", match.array)
        .resolves([rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call[] = [
        { contract: fake, functionFragment: "totalSupply", args: [] },
      ];

      const out = await sdk.tryAggregate(false, calls);

      expect(out[0][0]).to.be.false;

      expect(out[0][1] as string).to.match(/Data handling error:/);
    });
  });

  describe("tryBlockAndAggregate() & blockAndAggregate()", () => {
    it("returns blockNumber, blockHash, and decoded results", async () => {
      const bn = 42n,
        bh = "0xabcdef";

      const supplyData = erc20Interface.encodeFunctionResult("totalSupply", [
        1000n,
      ]);

      const rawResults: MulticallRawResult[] = [
        { success: true, returnData: supplyData },
      ];

      // rpcCall returns [bn, bh, rawResults]
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("tryBlockAndAggregate", match.array)
        .resolves([bn, bh, rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call[] = [
        { contract: fake, functionFragment: "totalSupply", args: [] },
      ];

      const out = await sdk.tryBlockAndAggregate(false, calls);

      expect(out.blockNumber).to.equal(bn);
      expect(out.blockHash).to.equal(bh);
      expect(out.returnData[0]).to.deep.equal([true, 1000n]);

      // blockAndAggregate is just an alias
      const out2 = await sdk.blockAndAggregate(calls);
      expect(out2.blockHash).to.equal(bh);
    });
  });

  describe("aggregate3()", () => {
    it("respects allowFailure and decodes", async () => {
      const nameOK = erc20Interface.encodeFunctionResult("name", ["X"]);

      const rawResults: MulticallRawResult[] = [
        { success: true, returnData: nameOK },
        { success: false, returnData: "0x00" },
      ];

      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("aggregate3", match.array)
        .resolves([rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call3[] = [
        {
          contract: fake,
          functionFragment: "name",
          args: [],
          allowFailure: true,
        },
        {
          contract: fake,
          functionFragment: "symbol",
          args: [],
          allowFailure: true,
        },
      ];

      const out = await sdk.aggregate3(calls);

      expect(out[0]).to.deep.equal([true, "X"]);
      expect(out[1]).to.deep.equal([false, "0x00"]);
    });
  });

  describe("aggregate3Value()", () => {
    it("sums values and decodes", async () => {
      const val1 = 10n,
        val2 = 15n;

      const balOK = erc20Interface.encodeFunctionResult("balanceOf", [500n]);

      const rawResults: MulticallRawResult[] = [
        { success: true, returnData: balOK },
      ];

      const rpcStub = sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("aggregate3Value", match.array, val1 + val2)
        .resolves([rawResults]);

      const fake = { address: DUMMY_ADDR, interface: erc20Interface } as any;

      const calls: Call3Value[] = [
        {
          contract: fake,
          functionFragment: "balanceOf",
          args: [DUMMY_ADDR],
          allowFailure: false,
          value: val1,
        },
        {
          contract: fake,
          functionFragment: "balanceOf",
          args: [DUMMY_ADDR],
          allowFailure: false,
          value: val2,
        },
      ];

      const out = await sdk.aggregate3Value(calls);

      expect(out[0]).to.deep.equal([true, 500n]);

      // ensure we passed the sum (25n) as msg.value
      assert.calledWith(rpcStub, "aggregate3Value", match.array, val1 + val2);
    });
  });

  describe("view helpers", () => {
    it("getBlockNumber → bigint", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getBlockNumber", [])
        .resolves([7n]);

      expect(await sdk.getBlockNumber()).to.equal(7n);
    });

    it("getBlockHash", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getBlockHash", [1n])
        .resolves(["0xfoo"]);

      expect(await sdk.getBlockHash(1n)).to.equal("0xfoo");
    });

    it("getLastBlockHash", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getLastBlockHash", [])
        .resolves(["0xbar"]);

      expect(await sdk.getLastBlockHash()).to.equal("0xbar");
    });

    it("getCurrentBlockTimestamp", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getCurrentBlockTimestamp", [])
        .resolves([161n]);

      expect(await sdk.getCurrentBlockTimestamp()).to.equal(161n);
    });

    it("getCurrentBlockGasLimit", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getCurrentBlockGasLimit", [])
        .resolves([8000000n]);

      expect(await sdk.getCurrentBlockGasLimit()).to.equal(8000000n);
    });

    it("getCurrentBlockCoinbase", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getCurrentBlockCoinbase", [])
        .resolves([DUMMY_ADDR]);

      expect(await sdk.getCurrentBlockCoinbase()).to.equal(DUMMY_ADDR);
    });

    it("getEthBalance", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getEthBalance", [DUMMY_ADDR])
        .resolves([99n]);

      expect(await sdk.getEthBalance(DUMMY_ADDR)).to.equal(99n);
    });

    it("getBasefee", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getBasefee", [])
        .resolves([200n]);

      expect(await sdk.getBasefee()).to.equal(200n);
    });

    it("getChainId", async () => {
      sandbox
        .stub(sdk as any, "rpcCall")
        .withArgs("getChainId", [])
        .resolves([ChainId.XRPLEVM_TESTNET]);

      expect(await sdk.getChainId()).to.equal(ChainId.XRPLEVM_TESTNET);
    });
  });
});
