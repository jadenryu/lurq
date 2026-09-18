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
import { parseRepoPolicy } from "../src/core/repoPolicy";
import { DEFAULT_REPO_POLICY } from "../src/github/types";

describe("parseRepoPolicy", () => {
  const good = { enabled: true, scope: "all", autoMerge: false, checks: { env: true } };

  it("accepts a complete policy unchanged", () => {
    expect(parseRepoPolicy(good)).toEqual(good);
  });

  it("rejects anything missing a field rather than filling it in", () => {
    expect(parseRepoPolicy({ enabled: true, scope: "all" })).toBeNull();
    expect(parseRepoPolicy({ ...good, scope: "everything" })).toBeNull();
    expect(parseRepoPolicy({ ...good, enabled: "yes" })).toBeNull();
    expect(parseRepoPolicy(null)).toBeNull();
    expect(parseRepoPolicy("enabled")).toBeNull();
  });

  it("carries a granted check through instead of rebuilding the policy", () => {
    expect(parseRepoPolicy(good)?.checks).toEqual({ env: true });
  });

  it("reads an absent or falsy check as not granted, never as permissive", () => {
    expect(parseRepoPolicy({ ...good, checks: undefined })?.checks).toBeUndefined();
    expect(parseRepoPolicy({ ...good, checks: { env: false } })?.checks).toEqual({ env: false });
    expect(parseRepoPolicy({ ...good, checks: { env: "on" } })?.checks).toEqual({ env: false });
  });

  it("carries mode through, and leaves an absent one absent", () => {
    // The field `mode` arrived after `checks` and landed in only some of the
    // copies of this parser — which is why there is now one. An absent mode must
    // stay absent rather than serialise as null: repoMode() reads `?? 'pr'`, and
    // a stored null is not the same as a missing key.
    expect(parseRepoPolicy({ ...good, mode: "fix" })?.mode).toBe("fix");
    expect(parseRepoPolicy({ ...good, mode: "comment" })?.mode).toBe("comment");
    expect(parseRepoPolicy(good)).not.toHaveProperty("mode");
    expect(parseRepoPolicy({ ...good, mode: "merge" })).not.toHaveProperty("mode");
  });

  it("accepts the shipped default, so the panel can round-trip it", () => {
    expect(parseRepoPolicy(DEFAULT_REPO_POLICY)).toEqual(DEFAULT_REPO_POLICY);
  });
});
