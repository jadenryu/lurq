import { CreateKeyDialog } from "@/components/dashboard/create-key-dialog";
import { KeysPanel } from "@/components/dashboard/keys-panel";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadKeys } from "@/lib/dashboard-data";

export default async function DashboardKeysPage() {
  const { data: keys, demo } = await loadKeys();

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const showOnboarding = activeKeys.length > 0 && activeKeys.every((k) => !k.lastUsedAt);

  return (
    <div>
      <PageHeader
        title="api keys"
        subtitle="Manage the keys that connect your coding agent to lurq."
        demo={demo}
        action={<CreateKeyDialog />}
      />

      {showOnboarding && (
        <div className="mt-8">
          <OnboardingPanel />
        </div>
      )}
      <div className="mt-8">
        <KeysPanel keys={keys} readOnly={demo} />
      </div>
    </div>
  );
}
