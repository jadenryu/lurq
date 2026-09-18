/**
 * The account-wide autopilot default, and the parser that guards both routes.
 *
 * Two failures are worth a test here, and neither shows up as an error:
 *
 *  - A default is a permission grant like any other policy, so the same
 *    "reject partial input rather than merge it" rule applies. A half-parsed
 *    default would arm every repo the owner connects from then on.
 *  - `checks` has to survive the trip. The web route and the backend both parse,
 *    and the stored policy is replaced wholesale, so a parser that rebuilds a
 *    three-key policy silently drops a granted check on the next save.
 */
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../apps/web/src/lib/parse-policy";
import { DEFAULT_REPO_POLICY } from "../src/github/types";

describe("parsePolicy", () => {
  const good = { enabled: true, scope: "all", autoMerge: false, checks: { env: true } };

  it("accepts a complete policy unchanged", () => {
    expect(parsePolicy(good)).toEqual(good);
  });

  it("rejects anything missing a field rather than filling it in", () => {
    expect(parsePolicy({ enabled: true, scope: "all" })).toBeNull();
    expect(parsePolicy({ ...good, scope: "everything" })).toBeNull();
    expect(parsePolicy({ ...good, enabled: "yes" })).toBeNull();
    expect(parsePolicy(null)).toBeNull();
    expect(parsePolicy("enabled")).toBeNull();
  });

  it("carries a granted check through instead of rebuilding the policy", () => {
    expect(parsePolicy(good)?.checks).toEqual({ env: true });
  });

  it("reads an absent or falsy check as not granted, never as permissive", () => {
    expect(parsePolicy({ ...good, checks: undefined })?.checks).toBeUndefined();
    expect(parsePolicy({ ...good, checks: { env: false } })?.checks).toEqual({ env: false });
    expect(parsePolicy({ ...good, checks: { env: "on" } })?.checks).toEqual({ env: false });
  });

  it("accepts the shipped default, so the panel can round-trip it", () => {
    expect(parsePolicy(DEFAULT_REPO_POLICY)).toEqual(DEFAULT_REPO_POLICY);
  });
});
