import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export { HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, WORDMARK } from "@/content/copy";

/** apps/web/src/app/styles/tokens.css, as a browser computes them. */
export const color = {
  ground: "#08080a",
  surface: "#101013",
  surface2: "#17171b",
  edge: "#232328",
  edgeLit: "#3e3e46",
  ink: "#f2f2ee",
  ink2: "#a0a099",
  ink3: "#82827a",
  bad: "#f87171",
  warn: "#fbbf24",
  good: "#4ade80",
  /** --bloom-from and --bloom-to (oklch) in sRGB, at the strength the site paints them. */
  bloomFrom: "rgba(245, 73, 0, 0.22)",
  bloomTo: "rgba(20, 71, 230, 0.30)",
};

export const SANS = "Geist";
export const MONO = "Commit Mono";

// Module scope: loadFont blocks rendering until each face is ready, so no frame
// is ever drawn in a fallback font.
loadFont({ family: SANS, url: staticFile("fonts/Geist-Variable.woff2"), weight: "100 900" });
loadFont({ family: MONO, url: staticFile("fonts/CommitMono-400-Regular.otf"), weight: "400" });
loadFont({ family: MONO, url: staticFile("fonts/CommitMono-700-Regular.otf"), weight: "700" });

export const AGENT_LOGOS = [
  { file: "claude-code", name: "Claude Code" },
  { file: "cursor", name: "Cursor" },
  { file: "windsurf", name: "Windsurf" },
  { file: "github-copilot", name: "Copilot" },
  { file: "codex-mark", name: "Codex" },
  { file: "vscode", name: "VS Code" },
  { file: "geminicli", name: "Gemini CLI" },
  { file: "kiro", name: "Kiro" },
  { file: "antigravity", name: "Antigravity" },
];
