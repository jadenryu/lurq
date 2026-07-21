import { Search, ScanLine, Boxes, GitCompare, type LucideIcon } from "lucide-react";

// The four lurq commands, shown as auto-advancing tabs with a terminal clip
// each. NOTE: the values in the clips are illustrative placeholders; swap for
// real CLI/MCP output before launch so the section stays verifiable.

export type ClipLine = {
  text: string;
  tone?: "prompt" | "dim" | "ok" | "bad" | "accent";
};

export type Capability = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  lines: ClipLine[];
};

export const capabilities: Capability[] = [
  {
    id: "recommend",
    icon: Search,
    title: "Recommend",
    body: "Ask in plain language. Get a short ranked list you can trust.",
    lines: [
      { text: 'lurq recommend "a form library for react"', tone: "prompt" },
      { text: "3 candidates · scored from npm · github · deps.dev", tone: "dim" },
      { text: "1  react-hook-form   94  proven" },
      { text: "2  @tanstack/form    81  emerging" },
      { text: "3  formik            76  proven" },
      { text: "→ pick: react-hook-form", tone: "accent" },
    ],
  },
  {
    id: "verify",
    icon: ScanLine,
    title: "Verify",
    body: "Check a package before your agent installs it.",
    lines: [
      { text: 'lurq verify "jsonwebtoken@8"', tone: "prompt" },
      { text: "✗ 2 open advisories · algorithm confusion", tone: "bad" },
      { text: "✗ last publish 2 years ago", tone: "bad" },
      { text: "→ use jose instead · 0 advisories", tone: "ok" },
    ],
  },
  {
    id: "plan",
    icon: Boxes,
    title: "Plan",
    body: "Fill every slot in the stack, and make sure the pieces fit.",
    lines: [
      { text: 'lurq plan "typescript api server"', tone: "prompt" },
      { text: "6 slots resolved · coherence ok", tone: "dim" },
      { text: "auth        jose         97" },
      { text: "validation  zod          99" },
      { text: "orm         drizzle-orm  91" },
      { text: "→ 3 more · stack health 96", tone: "accent" },
    ],
  },
  {
    id: "compare",
    icon: GitCompare,
    title: "Compare",
    body: "Put options side by side on what actually matters.",
    lines: [
      { text: "lurq compare date-fns dayjs moment", tone: "prompt" },
      { text: "date-fns  94  active · 3 KB" },
      { text: "dayjs     88  active · 2 KB" },
      { text: "moment    61  maintenance · 4.2 MB", tone: "bad" },
      { text: "→ winner: date-fns", tone: "accent" },
    ],
  },
];
