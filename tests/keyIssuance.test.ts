import { describe, it, expect } from "vitest";
import { secretEquals } from "../src/mcp/http";

describe("secretEquals (issuer-secret gate)", () => {
  it("accepts an exact match", () => {
    expect(secretEquals("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(secretEquals("s3cret-token", "s3cret-tokeX")).toBe(false);
  });

  it("does not throw on differing lengths and returns false", () => {
    expect(secretEquals("short", "a-much-longer-secret")).toBe(false);
    expect(secretEquals("", "x")).toBe(false);
  });
});
