import type { Metadata } from "next";
import { InlineError, Panel, eyebrow } from "@/components/dashboard/panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConformancePanel } from "@/components/dashboard/conformance-panel";
import { SelectionPolicyPanel } from "@/components/dashboard/selection-policy";
import { loadConformance, loadSelectionPolicy } from "@/lib/dashboard-data";

export const metadata: Metadata = {
  title: "selection policy",
  description: "Rules governing which packages your agents may install.",
};

/**
 * Selection policy lives on its own page rather than under a repository.
 *
 * The rules apply to every agent using the owner's key, including on code that
 * is not in a connected repo at all, an agent scaffolding a brand-new project
 * is exactly the moment a package choice becomes permanent, and there is no
 * repository to hang the setting off yet.
 */
export default async function PolicyPage() {
  const [{ data: policy, demo, failed }, { data: conformance }] = await Promise.all([
    loadSelectionPolicy(),
    loadConformance(),
  ]);

  return (
    <div>
      <PageHeader
        title="selection policy"
        subtitle="What your agents may install, as opposed to what they may upgrade."
        demo={demo}
      />

      <div className="mt-8 space-y-6">
        {failed && (
          <InlineError>
            The policy service is unreachable, so these rules could not be loaded. What you
            see below is the empty policy, not necessarily what is being enforced, don&apos;t
            save from this page until it reconnects.
          </InlineError>
        )}

        <SelectionPolicyPanel policy={policy} demo={demo} failed={failed} />

        {/* Directly under the editor, because the two are one loop: you write a
            rule, and the answer to "who does this affect" is the next thing
            anyone wants. Splitting them across pages is what makes a policy feel
            like a setting nobody can see the effect of. */}
        <ConformancePanel report={conformance} />

        <Panel padding="tight">
          <p className={eyebrow}>where these rules apply</p>
          <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-2">
            <p>
              <span className="font-mono text-xs text-ink">recommend</span>: blocked packages
              are dropped from the results, and the agent is told which ones and why. They are
              never silently removed: an agent handed three options when five were found will
              re-derive the blocked one from its own training and install it directly.
            </p>
            <p>
              <span className="font-mono text-xs text-ink">evaluate</span>: the call an agent
              makes about a package it found on its own, from training or a blog post or a
              colleague. This is the last point before an install where a rule can still
              apply, so the verdict is attached to the answer.
            </p>
            <p className="text-ink-3">
              Rules are enforced for every agent authenticating with your API key. They do not
              rewrite a manifest or touch code that already depends on a blocked package, that
              is autopilot&apos;s job, set per repository. What the rules do report on is the
              code you already have, above.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
