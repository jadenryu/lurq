import {
  RefreshCw,
  Gauge,
  ShieldCheck,
  Terminal,
  Boxes,
  type LucideIcon,
} from "lucide-react";

export type Feature = {
  icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  stat?: string;
};

export const features: Feature[] = [
  {
    icon: RefreshCw,
    label: "Always current",
    title: "Fresh, not frozen in training data",
    body: "Scores are recomputed from live npm, GitHub, and deps.dev signals – so your agent sees packages and versions released long after the model's cutoff.",
    stat: "Daily sync",
  },
  {
    icon: Gauge,
    label: "Evidence-based",
    title: "Objective scoring from real signals",
    body: "Health and confidence are derived from downloads, release cadence, maintenance, and security data - never hand-written opinions or popularity alone.",
    stat: "0 hand edits",
  },
  {
    icon: ShieldCheck,
    label: "Verified",
    title: "An anti-hallucination guard",
    body: "verify catches abandoned dependencies before your agent ever installs a package",
    stat: "verify built in",
  },
  {
    icon: Terminal,
    label: "Built for agents",
    title: "Agent-native by design",
    body: "MCP server, CLI, and installable skill with compact, token-aware responses. Works inside the tools your agent already runs in.",
    stat: "MCP + CLI",
  },
  {
    icon: Boxes,
    label: "Whole-stack",
    title: "Stack-aware recommendations",
    body: "compare ranks alternatives head-to-head and diagram sketches a reference architecture for the stack you've chosen.",
    stat: "compare + diagram",
  },
];
