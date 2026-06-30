import { TOKEN_TOPICS, ACL_TOPICS } from "@zama-fhe/sdk";
import type { Address, Hex, IndexedEvent, TokenActivityKind } from "@confidential-indexer/core";

export const erc7984Topics = {
  tokenTopics: TOKEN_TOPICS,
  aclTopics: ACL_TOPICS,
};

export interface TokenEventMetadata {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
}

type AlphaTokenEvent =
  | { eventName: "ConfidentialTransfer"; from: Address; to: Address; encryptedAmount: Hex }
  | { eventName: "Wrap"; to: Address; roundedAmount: bigint; encryptedWrappedAmount: Hex }
  | {
      eventName: "UnwrapRequested";
      receiver: Address;
      encryptedAmount: Hex;
      unwrapRequestId: Hex | null;
    }
  | {
      eventName: "UnwrapFinalized";
      receiver: Address;
      encryptedAmount: Hex;
      cleartextAmount: bigint;
      unwrapRequestId: Hex | null;
    };

const eventKind: Record<AlphaTokenEvent["eventName"], TokenActivityKind> = {
  ConfidentialTransfer: "confidential_transfer",
  Wrap: "shield",
  UnwrapRequested: "unshield_requested",
  UnwrapFinalized: "unshield_finalized",
};

export function normalizeTokenEvent(
  event: AlphaTokenEvent,
  metadata: TokenEventMetadata,
): IndexedEvent {
  const base = {
    ...metadata,
    kind: eventKind[event.eventName],
  };

  switch (event.eventName) {
    case "ConfidentialTransfer":
      return {
        ...base,
        kind: "confidential_transfer",
        from: event.from,
        to: event.to,
        encryptedAmount: event.encryptedAmount,
      };
    case "Wrap":
      return {
        ...base,
        kind: "shield",
        to: event.to,
        encryptedAmount: event.encryptedWrappedAmount,
        amount: event.roundedAmount,
      };
    case "UnwrapRequested":
      return {
        ...base,
        kind: "unshield_requested",
        receiver: event.receiver,
        encryptedAmount: event.encryptedAmount,
        unwrapRequestId: event.unwrapRequestId,
      };
    case "UnwrapFinalized":
      return {
        ...base,
        kind: "unshield_finalized",
        receiver: event.receiver,
        encryptedAmount: event.encryptedAmount,
        amount: event.cleartextAmount,
        unwrapRequestId: event.unwrapRequestId,
      };
  }
}
