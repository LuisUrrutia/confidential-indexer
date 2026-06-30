import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Address, Hex, IndexedEvent } from "@confidential-indexer/core";
import {
  recordEnvioAclEvent,
  recordEnvioTokenEvent,
  type EnvioAclEvent,
  type EnvioTokenEvent,
  type HyperindexEventWriter,
} from "../src/envioHandlers.js";

const tokenAddress = "0x0000000000000000000000000000000000000001" as Address;
const delegate = "0x00000000000000000000000000000000000000dd" as Address;
const delegator = "0x00000000000000000000000000000000000000ee" as Address;
const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

class CapturingWriter implements HyperindexEventWriter {
  readonly events: IndexedEvent[] = [];
  readonly heads: Array<{ chainId: number; tokenAddress: Address; headBlock: bigint }> = [];

  async upsertEvent(event: IndexedEvent): Promise<boolean> {
    this.events.push(event);
    return true;
  }

  async recordSourceHead(input: {
    chainId: number;
    tokenAddress: Address;
    headBlock: bigint;
  }): Promise<void> {
    this.heads.push(input);
  }
}

function tokenEvent(
  eventName: EnvioTokenEvent["eventName"],
  params: EnvioTokenEvent["params"],
  logIndex = 0,
): EnvioTokenEvent {
  return {
    eventName,
    chainId: 31337,
    srcAddress: tokenAddress,
    logIndex,
    block: { number: 123n, timestamp: new Date("2026-06-29T00:00:00.000Z") },
    transaction: { hash: txHash },
    params,
  };
}

function aclEvent(eventName: EnvioAclEvent["eventName"], contractAddress: Address): EnvioAclEvent {
  return {
    eventName,
    chainId: 31337,
    srcAddress: "0x0000000000000000000000000000000000000ac1" as Address,
    logIndex: 9,
    block: { number: 124n, timestamp: new Date("2026-06-29T00:00:12.000Z") },
    transaction: { hash: txHash },
    params: {
      delegator,
      delegate,
      contractAddress,
      newExpirationDate: 1_735_689_600n,
    },
  };
}

describe("Envio HyperIndex integration", () => {
  it("declares Envio contracts, events, schema, and scripts", async () => {
    const [config, schema, packageJson] = await Promise.all([
      readFile(new URL("../config.yaml", import.meta.url), "utf8"),
      readFile(new URL("../schema.graphql", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    expect(config).toContain("handler: ./src/handlers/erc7984.ts");
    expect(config).toContain("contracts:\n  - name: ConfidentialToken");
    expect(config).toContain("chains:\n  - id: 31337\n    start_block: 0\n    rpc:");
    expect(config).not.toContain("networks:");
    expect(config).not.toContain("abi_file_path: ../abis/");
    expect(config).toContain(
      "ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
    );
    expect(config).toContain(
      "Wrap(address indexed to, uint256 roundedAmount, bytes32 encryptedWrappedAmount)",
    );
    expect(config).toContain(
      "UnwrapRequested(address indexed receiver, bytes32 encryptedAmount, bytes32 unwrapRequestId)",
    );
    expect(config).toContain(
      "DelegatedForUserDecryption(address indexed delegator, address indexed delegate, address contractAddress, uint64 delegationCounter, uint64 oldExpirationDate, uint64 newExpirationDate)",
    );
    expect(schema).toContain("type HyperindexEvent");
    expect(schema).toContain("kind: String!");
    const parsed = JSON.parse(packageJson) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(parsed.scripts?.codegen).toBe("envio codegen");
    expect(parsed.scripts?.dev).toBe("envio dev");
    expect(parsed.dependencies?.envio).toMatch(/^\^3\./);
  });

  it("maps Envio token events into hyperindex_events rows", async () => {
    const writer = new CapturingWriter();

    await recordEnvioTokenEvent(
      tokenEvent("ConfidentialTransfer", {
        from: "0x00000000000000000000000000000000000000aa" as Address,
        to: "0x00000000000000000000000000000000000000bb" as Address,
        amount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
      }),
      writer,
    );
    await recordEnvioTokenEvent(
      tokenEvent(
        "UnwrapFinalized",
        {
          receiver: "0x00000000000000000000000000000000000000cc" as Address,
          encryptedAmount:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex,
          cleartextAmount: 7n,
          unwrapRequestId:
            "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
        },
        1,
      ),
      writer,
    );

    expect(writer.events).toMatchObject([
      {
        kind: "confidential_transfer",
        chainId: 31337,
        tokenAddress,
        txHash,
        logIndex: 0,
        encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        kind: "unshield_finalized",
        receiver: "0x00000000000000000000000000000000000000cc",
        encryptedAmount: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        amount: 7n,
      },
    ]);
    expect(writer.heads).toEqual([
      { chainId: 31337, tokenAddress, headBlock: 123n },
      { chainId: 31337, tokenAddress, headBlock: 123n },
    ]);
  });

  it("filters ACL delegations to configured confidential tokens", async () => {
    const writer = new CapturingWriter();

    await recordEnvioAclEvent(
      aclEvent("DelegatedForUserDecryption", tokenAddress),
      writer,
      new Set([tokenAddress]),
    );
    await recordEnvioAclEvent(
      aclEvent(
        "DelegatedForUserDecryption",
        "0x0000000000000000000000000000000000009999" as Address,
      ),
      writer,
      new Set([tokenAddress]),
    );

    expect(writer.events).toMatchObject([
      {
        kind: "delegation_granted",
        chainId: 31337,
        tokenAddress,
        delegator,
        delegate,
      },
    ]);
    expect(writer.heads).toEqual([{ chainId: 31337, tokenAddress, headBlock: 124n }]);
  });
});
