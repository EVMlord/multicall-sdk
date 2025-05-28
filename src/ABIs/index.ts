import { InterfaceAbi } from "ethers";
import { VERSION } from "../constants";
import Multicall3ABI from "./Multicall3ABI.json";

const abiSelector = (version: VERSION): InterfaceAbi => {
  switch (version) {
    case VERSION.V1:
      return JSON.stringify(Multicall3ABI);
    default:
      return JSON.stringify(Multicall3ABI);
  }
};

export { abiSelector, Multicall3ABI };
