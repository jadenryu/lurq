import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { PreferencesForm } from "@/components/dashboard/preferences-form";
import { loadSettings } from "@/lib/user-settings";

export const metadata: Metadata = {
  title: "preferences",
  description: "How the dashboard behaves for you.",
};

/**
 * One setting, and it is wired end to end.
 *
 * ponytail: the obvious way to fill a preferences page is a column of toggles —
 * theme, density, sounds, digests — and every one of them is a lie until
 * something reads it. This page carries the settings that actually change what
 * a page renders, and gains a row when a second one does. The dashboard is
 * dark-only by design (see the `dark` class on <html> in app/layout.tsx), so
 * there is no theme to offer; motion follows the OS via prefers-reduced-motion,
 * which is the setting the user already made somewhere better than here.
 *
 * The other two things a reader may come here looking for are real pages, so
 * they are signposted rather than duplicated.
 */
export default async function DashboardPreferencesPage() {
  const settings = await loadSettings();

  return (
    <div>
      <PageHeader title="preferences" subtitle="How the dashboard behaves for you." />

      <PageBody>
        <PreferencesForm defaultRangeDays={settings.defaultRangeDays} />

        <Panel>
          <PanelHeader title="settings that live elsewhere" />
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              Which packages your agents may install —{" "}
              <Link href="/dashboard/policy" className="underline underline-offset-4">
                selection policy
              </Link>
              .
            </li>
            <li>
              Email addresses, password, connected logins and MFA —{" "}
              <Link href="/dashboard/profile" className="underline underline-offset-4">
                profile
              </Link>
              .
            </li>
          </ul>
        </Panel>
      </PageBody>
    </div>
  );
}
