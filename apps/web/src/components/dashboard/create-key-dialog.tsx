"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/lib/use-copy";
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
 * design: rotate or generate another).
 */
export function CreateKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [policyWrite, setPolicyWrite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [isDemoKey, setIsDemoKey] = useState(false);
  const { copied, copy } = useCopy();

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, policyWrite }),
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

  function reset() {
    setOpen(false);
    // Let the close animation finish before clearing state under it.
    setTimeout(() => {
      setLabel("");
      setPolicyWrite(false);
      setError(null);
      setNewKey(null);
      setIsDemoKey(false);
      // The copy-confirm clears itself on its own timer inside useCopy, and it
      // is shorter than this one — nothing to reset here.
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
              <Button variant="outline" onClick={() => void copy(newKey)}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {!isDemoKey &&
              (policyWrite ? (
                <p className="text-sm text-muted-foreground">
                  Next: store it as a CI secret named{" "}
                  <code className="font-mono text-foreground">LURQ_API_KEY</code> and run{" "}
                  <code className="font-mono text-foreground">lurq policy push</code>. Keep it out
                  of agent configs.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Next: run <code className="font-mono text-foreground">npx lurqrun</code>{" "}
                  and paste this key to connect your coding agent.
                </p>
              ))}
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
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
                checked={policyWrite}
                onChange={(e) => setPolicyWrite(e.target.checked)}
              />
              <span>
                Can change selection policy
                <span className="block text-muted-foreground">
                  For <code className="font-mono">lurq policy push</code> in CI. Never paste this
                  key into a coding agent: it could loosen the rules that agent runs under.
                </span>
              </span>
            </label>
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
