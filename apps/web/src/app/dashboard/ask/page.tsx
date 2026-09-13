import type { Metadata } from "next";
import { AskPanel } from "@/components/dashboard/ask-panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "ask",
  description: "Ask about your repos, upgrades and the packages you depend on.",
};

/** `?q=` is how the ⌘K palette hands a question over: it asks on arrival. */
export default async function DashboardAskPage(props: PageProps<"/dashboard/ask">) {
  const { q } = await props.searchParams;
  return (
    <div>
      <PageHeader
        title="ask"
        subtitle="Questions about your repos, upgrades and dependencies, answered from lurq's index and your account, never from memory."
      />
      <PageBody>
        <AskPanel initial={typeof q === "string" ? q.slice(0, 500) : undefined} />
      </PageBody>
    </div>
  );
}
