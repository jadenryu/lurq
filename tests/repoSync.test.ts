import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseWebhook, verifyWebhookSignature } from "../src/github/webhook";
import { byRecentPush } from "../src/pipeline/repoScan";
import type { InstallationRepo } from "../src/github/manifests";
import type { RepoRow } from "../src/db/schema";

const SECRET = "webhook-s3cret";
const sign = (body: string) =>
  `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ action: "added", installation: { id: 42 } });

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(SECRET, body, sign(body))).toBe(true);
  });

  it("rejects a body tampered with after signing", () => {
    expect(verifyWebhookSignature(SECRET, `${body} `, sign(body))).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const forged = `sha256=${createHmac("sha256", "wrong").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(SECRET, body, forged)).toBe(false);
  });

  it("rejects missing, unprefixed, and malformed headers without throwing", () => {
    expect(verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "sha1=abcd")).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "sha256=")).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "sha256=zzzz")).toBe(false);
    // Right length, wrong bytes — the timingSafeEqual path rather than the
    // length guard, which is the comparison that actually has to hold.
    expect(verifyWebhookSignature(SECRET, body, `sha256=${"0".repeat(64)}`)).toBe(false);
  });
});

describe("parseWebhook", () => {
  it("reads both added and removed off installation_repositories", () => {
    expect(
      parseWebhook("installation_repositories", {
        action: "added",
        installation: { id: 7 },
        repositories_added: [{ full_name: "acme/api" }, { full_name: "acme/web" }],
        repositories_removed: [{ full_name: "acme/old" }],
      }),
    ).toEqual({
      kind: "repos-changed",
      installationId: 7,
      added: ["acme/api", "acme/web"],
      removed: ["acme/old"],
    });
  });

  it("treats an uninstall as an uninstall", () => {
    expect(parseWebhook("installation", { action: "deleted", installation: { id: 7 } })).toEqual({
      kind: "uninstalled",
      installationId: 7,
    });
  });

  it("ignores installation.created — only the redirect knows the lurq user", () => {
    const parsed = parseWebhook("installation", {
      action: "created",
      installation: { id: 7 },
      repositories: [{ full_name: "acme/api" }],
    });
    expect(parsed.kind).toBe("ignored");
  });

  it("ignores suspension, unrelated events, and empty changes", () => {
    expect(parseWebhook("installation", { action: "suspend", installation: { id: 7 } }).kind).toBe("ignored");
    expect(parseWebhook("push", { installation: { id: 7 } }).kind).toBe("ignored");
    expect(
      parseWebhook("installation_repositories", {
        action: "added",
        installation: { id: 7 },
        repositories_added: [],
        repositories_removed: [],
      }).kind,
    ).toBe("ignored");
  });

  it("refuses a payload with no usable installation id", () => {
    expect(parseWebhook("installation_repositories", { installation: {} }).kind).toBe("ignored");
    expect(parseWebhook("installation_repositories", { installation: { id: "7" } }).kind).toBe("ignored");
    expect(parseWebhook("installation_repositories", null).kind).toBe("ignored");
  });

  it("drops junk entries instead of trusting the array shape", () => {
    const parsed = parseWebhook("installation_repositories", {
      installation: { id: 7 },
      repositories_added: [{ full_name: "acme/api" }, { name: "no-full-name" }, null, "acme/x"],
      repositories_removed: "not-an-array",
    });
    expect(parsed).toEqual({
      kind: "repos-changed",
      installationId: 7,
      added: ["acme/api"],
      removed: [],
    });
  });
});

describe("byRecentPush", () => {
  const row = (fullName: string) => ({ fullName }) as RepoRow;
  const found = (fullName: string, pushedAt: string | null): InstallationRepo => ({
    fullName,
    defaultBranch: "main",
    isPrivate: false,
    pushedAt,
  });

  it("puts the most recently pushed repo first, whatever the incoming order", () => {
    const ordered = byRecentPush(
      [row("acme/a"), row("acme/b"), row("acme/c")],
      [
        found("acme/a", "2026-01-01T00:00:00Z"),
        found("acme/b", "2026-08-01T00:00:00Z"),
        found("acme/c", "2026-04-01T00:00:00Z"),
      ],
    );
    expect(ordered.map((r) => r.fullName)).toEqual(["acme/b", "acme/c", "acme/a"]);
  });

  it("sorts repos with no timestamp last and keeps rows absent from the inventory at the end", () => {
    const ordered = byRecentPush(
      [row("acme/unknown"), row("acme/undated"), row("acme/fresh")],
      [found("acme/undated", null), found("acme/fresh", "2026-08-01T00:00:00Z")],
    );
    expect(ordered.map((r) => r.fullName)).toEqual(["acme/fresh", "acme/undated", "acme/unknown"]);
  });

  it("does not mutate its input", () => {
    const rows = [row("acme/a"), row("acme/b")];
    byRecentPush(rows, [found("acme/b", "2026-08-01T00:00:00Z"), found("acme/a", null)]);
    expect(rows.map((r) => r.fullName)).toEqual(["acme/a", "acme/b"]);
  });
});
