import { Container } from "@/components/marketing/primitives";
import { CompatMatrix } from "@/components/marketing/compat-matrix";
import { shortDate, stackGraph } from "@/lib/marketing-data";

/**
 * The hero artifact: one stack every JS developer recognises, every pair in it
 * checked, on the one surface that looks like software rather than a document.
 *
 * Nothing in here has been installed, so nothing is called verified. The strongest
 * thing the grid can say is that two packages' own metadata disagree — which is
 * enough to matter, and is labelled as exactly that.
 */
/** The generated stack name is a fragment; it starts a sentence here. */
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function SectionStack() {
  const { nodes, counts, edges, stackName, checkedAt } = stackGraph;
  const conflicts = edges.filter((e) => e.verdict === "conflict");

  return (
    <section id="stack" className="pb-16 pt-10 md:pb-24 md:pt-14">
      <Container>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-sans text-[1.375rem] font-medium tracking-tight text-ink">
              {nodes.length} packages, every pair checked
            </h2>
            <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-soft">
              {sentence(stackName)}. Two pairs contradict each other in their own
              metadata — you would meet both as an install error.
            </p>
          </div>
          <p className="font-mono text-[0.75rem] text-ink-soft">
            checked {shortDate(checkedAt)}
          </p>
        </div>

        <CompatMatrix />

        <details className="mt-8 border-t border-rule">
          <summary className="cursor-pointer py-4 font-mono text-[0.8125rem] text-ink-soft transition-colors duration-[120ms] hover:text-mark">
            The {counts.conflict + counts.declared} declared relationships, in full
          </summary>
          <div className="pb-6">
            <ul className="space-y-3">
              {conflicts.map((e) => (
                <li
                  key={`${e.source}-${e.target}`}
                  className="border-l-2 border-conflict pl-3"
                >
                  <p className="font-mono text-[0.8125rem] text-ink">
                    {e.source} <span className="text-ink-soft/50">×</span> {e.target}
                  </p>
                  <p className="mt-1 font-mono text-[0.8125rem] text-ink-soft">
                    {e.detail}
                  </p>
                </li>
              ))}
            </ul>
            <ul className="mt-5 space-y-2 border-t border-rule pt-5">
              {edges
                .filter((e) => e.verdict !== "conflict")
                .map((e) => (
                  <li
                    key={`${e.source}-${e.target}`}
                    className="font-mono text-[0.8125rem] text-ink-soft"
                  >
                    <span className="text-ink">{e.source}</span> declares peer{" "}
                    <span className="text-ink">
                      {e.peer}@{e.range}
                    </span>
                    {e.optional ? " (optional)" : ""} — satisfied
                  </li>
                ))}
            </ul>
          </div>
        </details>
      </Container>
    </section>
  );
}
