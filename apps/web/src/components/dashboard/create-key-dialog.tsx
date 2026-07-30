"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/dashboard/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

/**
 * Mints a named key via POST /api/keys and shows it exactly once. The
 * plaintext is never persisted client-side; closing the dialog loses it (by
 * design — rotate or generate another).
 */
export function CreateKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [isDemoKey, setIsDemoKey] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const data = (await res.json()) as { key?: string; error?: string; demo?: boolean };
      if (!res.ok || !data.key) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setNewKey(data.key);
      setIsDemoKey(data.demo === true);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function reset() {
    setOpen(false);
    // Let the close animation finish before clearing state under it.
    setTimeout(() => {
      setLabel("");
      setError(null);
      setNewKey(null);
      setIsDemoKey(false);
      setCopied(false);
    }, 200);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : reset())}>
      <DialogTrigger render={<Button />}>New key</DialogTrigger>
      <DialogContent>
        {newKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2.5">
                Your new API key
                {isDemoKey && <Chip tone="warn">demo</Chip>}
              </DialogTitle>
              <DialogDescription>
                {isDemoKey
                  ? "This is a simulated key for design work. It won't authenticate anything."
                  : "Copy it now, it won't be shown again."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                {newKey}
              </code>
              <Button variant="outline" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {!isDemoKey && (
              <p className="text-sm text-muted-foreground">
                Next: run <code className="font-mono text-foreground">npx lurqrun install</code>{" "}
                and paste this key to connect your coding agent.
              </p>
            )}
            <DialogFooter>
              <Button onClick={reset}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Give it a label so you can tell your keys apart later (e.g. &quot;laptop&quot; or
                &quot;CI&quot;).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="key-label">Label (optional)</Label>
              <Input
                id="key-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="laptop"
                maxLength={200}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={generate} disabled={loading}>
                {loading ? "Generating…" : "Generate key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
