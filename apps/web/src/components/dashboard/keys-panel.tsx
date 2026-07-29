"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DashboardKey } from "@/lib/lurq-issuer";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const chipClass =
  "rounded-sm border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide";
const headClass = "font-mono text-xs font-normal uppercase tracking-wide text-muted-foreground/70";

/**
 * Lists the signed-in user's keys and lets them rotate/revoke. Mutations call
 * the /api/keys/[prefix]/revoke|rotate proxies, then router.refresh() so the
 * parent server component re-fetches and passes fresh props back down.
 */
export function KeysPanel({ keys }: { keys: DashboardKey[] }) {
  const router = useRouter();
  const [pendingRevoke, setPendingRevoke] = useState<DashboardKey | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(key: DashboardKey) {
    setRevokingId(key.id);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${key.prefix}/revoke`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not revoke key.");
        return;
      }
      setPendingRevoke(null);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRotate(key: DashboardKey) {
    setRotatingId(key.id);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${key.prefix}/rotate`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!res.ok || !data.key) {
        setError(data.error ?? "Could not rotate key.");
        return;
      }
      setRotatedKey(data.key);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRotatingId(null);
    }
  }

  async function copyRotated() {
    if (!rotatedKey) return;
    await navigator.clipboard.writeText(rotatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No keys yet — create one to connect a client.
      </p>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className={headClass}>Label</TableHead>
            <TableHead className={headClass}>Key</TableHead>
            <TableHead className={headClass}>Tier</TableHead>
            <TableHead className={headClass}>Created</TableHead>
            <TableHead className={headClass}>Last used</TableHead>
            <TableHead className={headClass}>Status</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.id} className="border-border/60">
              <TableCell className="font-medium">{key.label || "—"}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {key.prefix}…
              </TableCell>
              <TableCell>
                <span className={cn(chipClass, "border-border text-muted-foreground")}>
                  {key.tier}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(key.lastUsedAt)}</TableCell>
              <TableCell>
                {key.revokedAt ? (
                  <span className={cn(chipClass, "border-border text-muted-foreground/70")}>
                    Revoked
                  </span>
                ) : (
                  <span className={cn(chipClass, "border-foreground/25 text-foreground")}>
                    <span className="mr-1.5 inline-block size-1.5 rounded-full bg-foreground align-[1px]" />
                    Active
                  </span>
                )}
              </TableCell>
              <TableCell>
                {!key.revokedAt && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                      <MoreHorizontal />
                      <span className="sr-only">Actions</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={rotatingId === key.id}
                        onClick={() => handleRotate(key)}
                      >
                        {rotatingId === key.id ? "Rotating…" : "Rotate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setPendingRevoke(key)}>
                        Revoke
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Dialog open={!!pendingRevoke} onOpenChange={(next) => !next && setPendingRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              {pendingRevoke?.label || pendingRevoke?.prefix} will stop working immediately. Any
              client using it will need a new key.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={revokingId === pendingRevoke?.id}
              onClick={() => pendingRevoke && handleRevoke(pendingRevoke)}
            >
              {revokingId === pendingRevoke?.id ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rotatedKey} onOpenChange={(next) => !next && setRotatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your rotated key</DialogTitle>
            <DialogDescription>
              Copy it now — it won&apos;t be shown again. The old key stopped working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
              {rotatedKey}
            </code>
            <Button variant="outline" onClick={copyRotated}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <DialogFooter>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
