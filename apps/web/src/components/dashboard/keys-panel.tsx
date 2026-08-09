"use client";

import { useMemo, useState } from "react";
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
import { Chip, EmptyState, Panel } from "@/components/dashboard/panel";
import { TableToolbar, thClass } from "@/components/dashboard/table-toolbar";
import type { DashboardKey } from "@/lib/lurq-issuer";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const FILTERS = [
  { id: "active", label: "active" },
  { id: "revoked", label: "revoked" },
  { id: "all", label: "all" },
];

/**
 * Lists the signed-in user's keys and lets them rotate/revoke. Mutations call the
 * /api/keys/[prefix]/revoke|rotate proxies, then router.refresh() so the parent
 * server component re-fetches and passes fresh props back down.
 *
 * `readOnly` is set when the rows are demo fixtures: their prefixes don't exist in
 * `api_keys`, so offering Rotate/Revoke would just produce a 404.
 */
export function KeysPanel({ keys, readOnly = false }: { keys: DashboardKey[]; readOnly?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [pendingRevoke, setPendingRevoke] = useState<DashboardKey | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys.filter((k) => {
      if (filter === "active" && k.revokedAt) return false;
      if (filter === "revoked" && !k.revokedAt) return false;
      if (!q) return true;
      return (
        (k.label ?? "").toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q)
      );
    });
  }, [keys, query, filter]);

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

  return (
    <div className="space-y-4">
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by label or prefix…"
        filters={FILTERS}
        activeFilter={filter}
        onFilterChange={setFilter}
        count={visible.length}
        noun="key"
      />

      {keys.length === 0 ? (
        <EmptyState title="No keys yet">
          Create one with <span className="text-foreground">New key</span>, then run{" "}
          <code className="font-mono text-foreground">npx lurqrun</code>.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="No matches" />
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className={thClass}>Label</TableHead>
                  <TableHead className={thClass}>Key</TableHead>
                  <TableHead className={thClass}>Tier</TableHead>
                  <TableHead className={thClass}>Created</TableHead>
                  <TableHead className={thClass}>Last used</TableHead>
                  <TableHead className={thClass}>Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((key) => (
                  <TableRow key={key.id} className="border-border/60">
                    <TableCell className="font-medium">{key.label || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {key.prefix}…
                    </TableCell>
                    <TableCell>
                      <Chip>{key.tier}</Chip>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(key.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(key.lastUsedAt)}
                    </TableCell>
                    <TableCell>
                      {key.revokedAt ? (
                        <Chip dot>Revoked</Chip>
                      ) : (
                        <Chip tone="good" dot>
                          Active
                        </Chip>
                      )}
                    </TableCell>
                    <TableCell>
                      {!key.revokedAt && !readOnly && (
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
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setPendingRevoke(key)}
                            >
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
          </div>
        </Panel>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}

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
              Copy it now: it won&apos;t be shown again. The old key stopped working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
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
