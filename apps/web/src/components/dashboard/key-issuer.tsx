"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Mints a key via /api/keys and shows it exactly once. The plaintext is never
 * persisted client-side; refreshing loses it (by design — generate another).
 */
export function KeyIssuer() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", { method: "POST" });
      const data = (await res.json()) as { key?: string; error?: string };
      if (!res.ok || !data.key) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setApiKey(data.key);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (apiKey) {
    return (
      <div className="rounded-xl border border-border p-6">
        <p className="text-sm font-medium">
          Your new API key. Copy it now, it won&apos;t be shown again.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
            {apiKey}
          </code>
          <Button variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Next: run <code className="font-mono">npx lurqrun install</code> and paste this key to
          connect your coding agent.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Button onClick={generate} disabled={loading}>
        {loading ? "Generating…" : "Generate API key"}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
