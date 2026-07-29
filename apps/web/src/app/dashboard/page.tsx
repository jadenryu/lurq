import { auth } from "@clerk/nextjs/server";
import { CreateKeyDialog } from "@/components/dashboard/create-key-dialog";
import { KeysPanel } from "@/components/dashboard/keys-panel";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        title="api keys"
        subtitle="Manage the keys that connect your coding agent to lurq."
        action={<CreateKeyDialog />}
      />

      {showOnboarding && (
        <div className="mt-8">
          <OnboardingPanel />
        </div>
      )}

      <div className="panel-lit mt-8 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
          {activeKeys.length} active {activeKeys.length === 1 ? "key" : "keys"}
        </p>
        <div className="mt-5">
          <KeysPanel keys={keys} />
        </div>
      </div>
    </div>
  );
}
