import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@confidential-indexer/core/testing": fileURLToPath(
        new URL("./packages/core/src/testing/index.ts", import.meta.url),
      ),
      "@confidential-indexer/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@confidential-indexer/db": fileURLToPath(
        new URL("./packages/db/src/index.ts", import.meta.url),
      ),
      "@confidential-indexer/hyperindex-adapter": fileURLToPath(
        new URL("./packages/hyperindex-adapter/src/index.ts", import.meta.url),
      ),
      "@confidential-indexer/zama": fileURLToPath(
        new URL("./packages/zama/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 20_000,
    passWithNoTests: true,
  },
});
