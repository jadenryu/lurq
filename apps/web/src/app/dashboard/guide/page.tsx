import { PageHeader } from "@/components/dashboard/page-header";
import {
  CliSection,
  ConnectSection,
  GuideSection,
  ScoringSection,
  ToolsSection,
  TriggersSection,
} from "@/components/dashboard/guide-sections";
import { loadKeys } from "@/lib/dashboard-data";

/**
 * In-dashboard usage guide. Everything on this page is transcribed from the live
 * backend (see src/content/guide.ts for the provenance of each list), so a user
 * reading it can't be told about a capability the server doesn't expose.
 */
export default async function DashboardGuidePage() {
  const { data: keys } = await loadKeys();
  const hasKey = keys.some((k) => !k.revokedAt);

  return (
    <div>
      <PageHeader
        title="how to use lurq"
        subtitle="Connect it once. Your agent calls it on its own from then on."
      />

      <div className="mt-10 space-y-14">
        <GuideSection
          index={1}
          label="connect"
          title="Three steps to your first call"
        >
          <ConnectSection hasKey={hasKey} />
        </GuideSection>

        <GuideSection
          index={2}
          label="when it kicks in"
          title="The moments lurq intercepts"
          intro="You never type a tool name. These are the triggers your agent has been given."
        >
          <TriggersSection />
        </GuideSection>

        <GuideSection
          index={3}
          label="the tools"
          title="What your agent can call"
          intro="Nine tools over MCP."
        >
          <ToolsSection />
        </GuideSection>

        <GuideSection
          index={4}
          label="scoring"
          title="How lurq decides what's good"
          intro="Computed from public signals, never editorial."
        >
          <ScoringSection />
        </GuideSection>

        <GuideSection
          index={5}
          label="terminal"
          title="Or use it directly"
          intro="Same index, same handlers, no agent in the loop."
        >
          <CliSection />
        </GuideSection>
      </div>
    </div>
  );
}
