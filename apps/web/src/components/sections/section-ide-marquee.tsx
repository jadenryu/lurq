import { Marquee } from "@/components/ui/marquee";

// Each editor's logo lives in /public/logos as an SVG. Claude Code, Cursor,
// Windsurf, GitHub Copilot, and Codex use their real brand marks (official
// colors where the brand has one). vscode.svg is still a generic placeholder
// glyph tinted VS Code blue — swap in the official mark if you get one.
const IDES = [
  { name: "Claude Code", logo: "/logos/claude-code.svg" },
  { name: "Cursor", logo: "/logos/cursor.svg" },
  { name: "Windsurf", logo: "/logos/windsurf.svg" },
  { name: "GitHub Copilot", logo: "/logos/github-copilot.svg" },
  { name: "VS Code", logo: "/logos/vscode.svg" },
  { name: "Codex", logo: "/logos/codex.svg" },
];

export function SectionIdeMarquee() {
  return (
    <section className="relative overflow-hidden border-y border-border/60 py-10">
      <p className="mb-6 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground/60">
        Works with the tools your team already uses
      </p>

      <Marquee pauseOnHover className="[--duration:32s] [--gap:3.5rem]">
        {IDES.map(({ name, logo }) => (
          <div
            key={name}
            className="flex items-center gap-3 px-2 text-foreground/85 transition-colors hover:text-foreground"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt={`${name} logo`} className="size-5 shrink-0" />
            <span className="whitespace-nowrap text-lg font-medium tracking-tight">
              {name}
            </span>
          </div>
        ))}
      </Marquee>

      {/* fade the strip into the page at both edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
    </section>
  );
}
