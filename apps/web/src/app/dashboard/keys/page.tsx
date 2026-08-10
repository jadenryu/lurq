import { CreateKeyDialog } from "@/components/dashboard/create-key-dialog";
import { KeysPanel } from "@/components/dashboard/keys-panel";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { InlineError } from "@/components/dashboard/panel";
import { loadKeys } from "@/lib/dashboard-data";

export default async function DashboardKeysPage() {
  const { data: keys, demo, failed } = await loadKeys();

  const activeKeys = keys.filter((k) => !k.revokedAt);
  // Only claim someone is new when we actually know they are. On a failed read
  // `keys` is the empty fallback, and every branch below would otherwise treat
  // that as a fresh account.
  const showOnboarding = !failed && activeKeys.length > 0 && activeKeys.every((k) => !k.lastUsedAt);

  return (
    <div>
      <PageHeader
        title="api keys"
        subtitle="Manage the keys that connect your coding agent to lurq."
        demo={demo}
        action={<CreateKeyDialog />}
      />

      {/*
        Every other dashboard page renders a failed read as the new-user state,
        which is right for them: an empty activity feed and an unreachable one
        both mean "nothing to show". Keys are the exception. "No keys yet" next
        to a New key button is an instruction, and following it while the
        service is down mints a duplicate credential for an account that already
        has working ones — the user cannot see the keys they hold, so they have
        no way to know. Say it plainly instead.
      */}
      {failed && (
        <div className="mt-8">
          <InlineError>
            The key service is unreachable, so your keys could not be loaded. This is not an
            empty account, don&apos;t create a new key from this page until it reconnects,
            and any key you already have keeps working.
          </InlineError>
        </div>
      )}

      {showOnboarding && (
        <div className="mt-8">
          <OnboardingPanel />
        </div>
      )}
      <div className="mt-8">
        <KeysPanel keys={keys} readOnly={demo || failed} />
      </div>
    </div>
  );
}
