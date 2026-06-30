import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../src/app-config.js";

const privateKey = `0x${"1".repeat(64)}`;

describe("API config", () => {
  it("omits optional relayer auth when the env value is empty", () => {
    const config = loadAppConfig({
      DATABASE_URL: "postgres://indexer:indexer@localhost:5432/confidential_indexer",
      ADMIN_API_KEY: "secret",
      API_PORT: "3001",
      RELAYER_API_KEY: "",
      INDEXER_SIGNER_PRIVATE_KEY_11155111: privateKey,
      NETWORKS_JSON: JSON.stringify([
        {
          chainId: 11155111,
          name: "sepolia",
          rpcUrl: "https://example.com/rpc",
          relayerUrl: "https://relayer.testnet.zama.org/v2",
          indexerSignerPrivateKeyEnv: "INDEXER_SIGNER_PRIVATE_KEY_11155111",
          tokens: [],
        },
      ]),
    });

    expect(config.networks[0].relayerApiKey).toBeUndefined();
  });
});
