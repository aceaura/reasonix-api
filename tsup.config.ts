import { defineConfig } from "tsup";

export default defineConfig([
  // Library build
  {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: "esm",
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["reasonix"],
  },
  // CLI entry
  {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: "esm",
    dts: false,
    sourcemap: true,
    clean: false,
    platform: "node",
    external: ["reasonix"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
