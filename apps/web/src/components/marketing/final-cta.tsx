import { CopyCommand } from "@/components/marketing/copy-command";
import { INSTALL_COMMAND } from "@/lib/marketing-copy";
import { DOCS_URL } from "@/lib/site-links";

/**
 * Full-bleed dark band, visually distinct from everything above it — the safety
 * net for anyone who scrolled straight past the hero.
 */
export function SectionFinalCta() {
  return (
    <section className="bg-viewport px-6 py-24 text-center md:py-32">
      <h2 className="t-display mx-auto max-w-[24ch] text-viewport-ink">
        Find out before you install it, not after.
      </h2>

      <div className="mt-10 flex justify-center">
        <CopyCommand command={INSTALL_COMMAND} variant="block" />
      </div>

      <p className="mt-8">
        <a
          href={DOCS_URL}
          className="t-data text-viewport-ink/50 underline decoration-viewport-3 underline-offset-4 transition-colors duration-[120ms] hover:text-viewport-ink"
        >
          Or read the docs first
        </a>
      </p>
    </section>
  );
}
