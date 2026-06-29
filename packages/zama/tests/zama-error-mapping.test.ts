import { describe, expect, it } from "vitest";
import { mapZamaError } from "../src/index.js";

describe("mapZamaError", () => {
  it("maps delegation errors to not_delegated", () => {
    expect(mapZamaError(new Error("DelegationNotFoundError: no active delegation"))).toEqual({ status: "not_delegated", reason: "missing_delegation" });
  });

  it("maps propagation-like errors to retryable_error", () => {
    expect(mapZamaError(new Error("gateway has not synced ACL state yet"))).toEqual({ status: "retryable_error", reason: "delegation_propagating" });
  });

  it("maps unknown SDK errors to retryable_error", () => {
    expect(mapZamaError(new Error("relayer request failed"))).toEqual({ status: "retryable_error", reason: "sdk_error" });
  });
});
