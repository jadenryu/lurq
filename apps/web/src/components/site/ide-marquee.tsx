import { IDE_HEADING, IDE_SUB } from "@/content/copy";

/**
 * Where lurq runs, as a band that crosses the whole page.
 *
 * A compatibility claim, not a customer claim: no count, no company logo, and
 * nowhere the word "trusted". The labels are what make it a claim. Unlabelled
 * glyphs make a reader squint; labelled ones make a reader check whether theirs
 * is on the list.
 *
 * Every entry here is one `lurqrun install --agent <id>` target in
 * src/cli/installSkill.ts, because the heading promises one command. A logo the
 * installer cannot write config for does not belong on this list, however much
 * it would fill the track.
 *
 * The track is rendered twice and translated by exactly its own width, which is
 * what makes the loop seamless. The second copy is aria-hidden so the list is
 * announced once. It stops on hover and does not run at all under reduced
 * motion: a loop nobody can pause is what makes marquees hostile.
 */
const CLIENTS = [
  { name: "Claude Code", src: "/logos/claude-code.svg" },
  { name: "Cursor", src: "/logos/cursor.svg" },
  { name: "Windsurf", src: "/logos/windsurf.svg" },
  { name: "Copilot", src: "/logos/github-copilot.svg" },
  { name: "Codex", src: "/logos/codex-mark.svg" },
  { name: "VS Code", src: "/logos/vscode.svg" },
  { name: "Gemini CLI", src: "/logos/geminicli.svg" },
  { name: "Antigravity", src: "/logos/antigravity.svg" },
  { name: "Kiro", src: "/logos/kiro.svg" },
] as const;

function Track({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden} className="room-marquee-track">
      {CLIENTS.map((c) => (
        <li key={c.name} className="room-marquee-item">
          <span
            aria-hidden
            className="room-ide-mark"
            style={{ ["--mark-src" as string]: `url(${c.src})` }}
          />
          <span className="room-ide-label">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function IdeMarquee() {
  return (
    // ASYMMETRIC, and deliberately not the page's py-24/py-32.
    //
    // The top is tight because this band belongs to the hero above it: it answers
    // the first question the headline raises, and a full section gap at that seam
    // reads as the hero having run out rather than as a new section starting. The
    // bottom is the standard pad, so the normal rhythm resumes into #verify.
    //
    // Set here and in hero.tsx together. Change one and the seam goes lopsided.
    <section id="installs" className="w-full pb-24 pt-14 min-[900px]:pb-32 min-[900px]:pt-16">
      <h2 className="px-4 text-center font-sans text-[20px] font-medium text-ink">
        {IDE_HEADING}
      </h2>
      <p className="mt-3 px-4 text-center font-mono text-[12px] text-ink-3">{IDE_SUB}</p>

      <div className="room-marquee mt-12">
        <Track />
        <Track hidden />
      </div>
    </section>
  );
}
