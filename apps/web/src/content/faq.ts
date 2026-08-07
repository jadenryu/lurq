import stats from "@/content/generated/stats.json";

export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "What is lurq?",
    a: "lurq is a dynamic index of JS/TS packages that your coding agent checks before install. We score packages from public signals and verify in sandboxes where necessary. Your agent asks lurq, then writes the code.",
  },
  {
    q: "How is it different from just asking my model?",
    a: "Models remember what was popular when they were trained. lurq suggests newer options, flags outdated versions, and hands agents the code they need to craft the strongest stack for you.",
  },
  {
    q: "What do you mean by execution-verified?",
    a: "lurq reads metadata: downloads, release dates, advisories. But, lurq also returns info from sandboxed trials. Did the install succeed? Does it import? Do these two versions coexist? We outrace the changelog and the training data.",
  },
  {
    q: "Why does a whole stack need checking, not just each package?",
    a: "Because six individually healthy packages can still refuse to install together. Peer ranges conflict, engines disagree, transitive versions collide. lurq mines compatibility from co-installs, so a stack can hold together rather than break later from a simple upgrade.",
  },
  {
    q: "Which tools does it work with?",
    a: "Claude Code, Cursor, Windsurf, VS Code / Copilot, Codex, Gemini CLI, Antigravity, Kiro, and anything else that can use a CLI or MCP connection. One install step writes the config file each of those already reads.",
  },
  {
    /**
     * REWRITTEN, because the old answer opened "The index refreshes daily" and
     * nothing backs that. stats.json reports the last sync as `partial`, having
     * seen 295 of 3,315 packages. The per-answer timestamp was always the
     * stronger claim: it is checkable per call, where a cadence is a promise.
     */
    q: "How current is it?",
    a: "Every answer carries a dataAsOf timestamp, so you can see exactly how old the reading is.",
  },
  {
    /**
     * The coverage figure is read from stats.json, not typed here, for the same
     * reason the version eyebrow and every provenance stat are: a number in
     * prose is the one number nobody re-checks when the pipeline moves.
     *
     * It also says "package versions", not "packages". `apiSurfaces` counts rows
     * in api_surfaces, whose unique index is (package_name, version), so one
     * package with two extracted versions contributes two. Stating it as a
     * package count against the 3,315 package total compared two different units
     * and overstated coverage.
     */
    q: "What doesn't work yet?",
    a: `Three things, honestly. The API surface index covers ${stats.apiSurfaces} package versions so far, so for most packages the exact-signature answer is not there yet. Sandbox verification runs on a queue rather than on demand, which means a brand new pair may not have been executed when you ask. And the whole index is JS/TS only, with no plans for other ecosystems until this one is solid.`,
  },
  {
    q: "Is it free?",
    a: "Yes, free to get started. Create an account, generate an API key, and you get the CLI, the agent connection, and the installable skill with a monthly allowance of hosted calls.",
  },
];
