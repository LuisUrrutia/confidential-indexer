import { describe, expect, it } from "vitest";
import {
  BalanceSource,
  BalanceStatus,
  DecryptionReason,
  DecryptionStatus,
  HistoryCompleteness,
  IndexedEventKind,
  TokenActivityKind,
  DECRYPTION_REASON_VALUES,
  DECRYPTION_STATUS_VALUES,
  INDEXED_EVENT_KIND_VALUES,
  TOKEN_ACTIVITY_KIND_VALUES,
} from "../src/index.js";

describe("domain constants", () => {
  it("exports token and delegation event kinds from one shared source", () => {
    expect(TokenActivityKind.ConfidentialTransfer).toBe("confidential_transfer");
    expect(TokenActivityKind.Shield).toBe("shield");
    expect(TokenActivityKind.UnshieldRequested).toBe("unshield_requested");
    expect(TokenActivityKind.UnshieldFinalized).toBe("unshield_finalized");
    expect(IndexedEventKind.DelegationGranted).toBe("delegation_granted");
    expect(IndexedEventKind.DelegationRevoked).toBe("delegation_revoked");
    expect(TOKEN_ACTIVITY_KIND_VALUES).toEqual([
      TokenActivityKind.ConfidentialTransfer,
      TokenActivityKind.Shield,
      TokenActivityKind.UnshieldRequested,
      TokenActivityKind.UnshieldFinalized,
    ]);
    expect(INDEXED_EVENT_KIND_VALUES).toContain(IndexedEventKind.DelegationGranted);
  });

  it("exports decryption, balance, and history values for adapters", () => {
    expect(DecryptionStatus.NotDelegated).toBe("not_delegated");
    expect(DecryptionReason.MissingDelegation).toBe("missing_delegation");
    expect(BalanceStatus.Known).toBe("known");
    expect(BalanceSource.DirectDecrypt).toBe("direct_decrypt");
    expect(HistoryCompleteness.Partial).toBe("partial");
    expect(DECRYPTION_STATUS_VALUES).toContain(DecryptionStatus.RetryableError);
    expect(DECRYPTION_REASON_VALUES).toContain(DecryptionReason.SdkError);
  });
});
