import { auth } from "@clerk/nextjs/server";
import { CreateKeyDialog } from "@/components/dashboard/create-key-dialog";
import { KeysPanel } from "@/components/dashboard/keys-panel";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { fetchKeys, type DashboardKey } from "@/lib/lurq-issuer";

export default async function DashboardKeysPage() {
  const { userId } = await auth();

  // Degrades independently — an MCP-server hiccup shouldn't 500 the page.
  let keys: DashboardKey[] = [];
  try {
    keys = userId ? await fetchKeys(userId) : [];
  } catch {
    keys = [];
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const showOnboarding = activeKeys.length > 0 && activeKeys.every((k) => !k.lastUsedAt);

  return (
    <div>
      <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
        api keys
      </h1>
      <p className="mt-3 text-muted-foreground">
        Manage the keys that connect your coding agent to lurq.
      </p>

      {showOnboarding && (
        <div className="mt-10">
          <OnboardingPanel />
        </div>
      )}

      <div className="panel-lit mt-10 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
            {activeKeys.length} active {activeKeys.length === 1 ? "key" : "keys"}
          </p>
          <CreateKeyDialog />
        </div>
        <div className="mt-5">
          <KeysPanel keys={keys} />
        </div>
      </div>
    </div>
  );
}
