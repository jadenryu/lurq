import { Breakout, Container } from "@/components/marketing/primitives";
import { CopyCommand } from "@/components/marketing/copy-command";
import { heroRecording } from "@/content/recording";
import { INSTALL_COMMAND } from "@/lib/marketing-copy";
import { stats } from "@/lib/marketing-data";
import { DOCS_URL } from "@/lib/site-links";

/**
 * Centred, and deliberately not clever — this is the near-universal dev-tool
 * pattern and it works. The one thing worth getting clever about is the graph
 * directly below it.
 */
export function Hero() {
  return (
    <section className="pt-14 md:pt-24">
      <Container>
        <div className="mx-auto max-w-[46rem] text-center">
          <p className="t-label normal-case tracking-normal">
            v{stats.npm.latestVersion ?? "0.0.6"} · live on npm · Apache-2.0
          </p>

          {/* Two lines, broken on purpose — the second one is the whole claim.
              `lurq` stays lowercase because that is the name. */}
          <h1 className="t-display mt-5 text-ink">
            Your agent picks the packages.
            <br className="hidden sm:inline" /> lurq knows what happens next.
          </h1>

          <p className="t-lead mx-auto mt-6 max-w-[60ch]">
            An MCP server your coding agent calls before it installs anything. It reads
            the shipped types, checks the combinations, and answers from evidence.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <CopyCommand command={INSTALL_COMMAND} variant="primary" />
            <a
              href={DOCS_URL}
              className="inline-flex h-11 items-center rounded border border-rule px-5 text-[0.9375rem] font-medium text-ink transition-colors duration-[120ms] hover:border-mark/50 hover:text-mark"
            >
              Read the docs
            </a>
          </div>
        </div>
      </Container>

      <HeroRecording />
    </section>
  );
}

/** Renders only once a real clip exists (see content/recording.ts). */
function HeroRecording() {
  const { src, mp4, poster, caption } = heroRecording;
  if (!src && !mp4) return null;

  return (
    <Breakout className="mt-12">
      <div className="instrument overflow-hidden">
        {/* Silent terminal capture — no speech to caption; the copy around it
            carries the meaning. */}
        <video
          className="block w-full"
          autoPlay
          muted
          loop
          playsInline
          controls
          poster={poster}
          preload="metadata"
        >
          {src ? <source src={src} type="video/webm" /> : null}
          {mp4 ? <source src={mp4} type="video/mp4" /> : null}
        </video>
      </div>
      {caption ? <p className="t-label mt-4 text-center">{caption}</p> : null}
    </Breakout>
  );
}
