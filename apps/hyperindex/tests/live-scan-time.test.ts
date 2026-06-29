import { describe, expect, it } from "vitest";
import { toDate, toExpirationDate } from "../src/time.js";

describe("live scan timestamp helpers", () => {
  it("treats zero delegation expiry as non-expiring", () => {
    expect(toExpirationDate(0n)).toBeNull();
  });

  it("converts safe epoch seconds without throwing", () => {
    expect(() => toExpirationDate(1_735_689_600n)).not.toThrow();
    expect(toExpirationDate(1_735_689_600n)).toEqual(new Date("2025-01-01T00:00:00.000Z"));
  });

  it("ignores epochs that cannot be represented safely in milliseconds", () => {
    expect(toExpirationDate(9_007_199_254_741n)).toBeNull();
  });

  it("converts block timestamps from seconds", () => {
    expect(toDate(1_735_689_600n)).toEqual(new Date("2025-01-01T00:00:00.000Z"));
  });
});
