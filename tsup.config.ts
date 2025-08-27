import { defineConfig } from "tsup";
import pkg from "./package.json";

// peers you want to keep external (ethers stays external for ESM build)
const peers: string[] = Object.keys(pkg.peerDependencies ?? {});

export default defineConfig([
  // ESM build: ethers external
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: { entry: "src/index.ts" }, // emit dist/index.d.ts
    outDir: "dist",
    clean: true,
    minify: true,
    splitting: false,
    treeshake: true,
    sourcemap: false,
    platform: "node",
    target: "node18",
    external: peers,
    env: { NODE_ENV: "production" },
    outExtension: () => ({ js: ".esm.js" }),
  },
  //   // CJS build: not supported
  //   {
  //     entry: { index: "src/index.ts" },
  //     format: ["cjs"],
  //     dts: false, // avoid duplicate d.ts
  //     outDir: "dist",
  //     clean: false,
  //     minify: true,
  //     splitting: false,
  //     treeshake: true,
  //     sourcemap: false,
  //     external: peers,
  //     env: { NODE_ENV: "production" },
  //     outExtension: () => ({ js: ".cjs.js" }),
  //   },
]);
