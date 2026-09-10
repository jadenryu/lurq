"use client";

import { Tabs } from "@base-ui/react/tabs";
import { DIAGRAMS } from "@/components/site/diagrams";
import { SHOWCASE_HEAD, TOOLS } from "@/content/tools";
import { DOCS_URL } from "@/lib/site-links";

/**
 * All ten tools, one at a time, with the schema each one takes.
 *
 * WHAT THIS SECTION IS FOR. capability-grid says what lurq can answer, in
 * questions. This says what an agent literally sends and what literally comes
 * back, which is the next thing a developer wants and the thing the page had no
 * answer for anywhere: the whole site could be read without ever seeing a
 * request body.
 *
 * NO STORED ANSWERS. The right-hand panel prints a request and a response
 * SHAPE, never a response. content/tools.ts carries the reason at length; the
 * short version is that a verdict on a marketing page is a claim about a day
 * that has already passed, and content/agent-session.ts is the one section
 * allowed to show a recorded run because a generator writes it.
 *
 * WHY TABS AND NOT TEN SECTIONS. Ten tools is a page of scrolling if each one
 * gets a band, and nobody reads the tenth. It is also not surface-switch's
 * vertical rail: that silhouette is already spent two sections down, and ten
 * items do not fit a rail without giving it a scrollbar.
 *
 * Base UI's Tabs, not a useState and eleven divs, for the boring reasons: roving
 * tabindex, arrow keys, the correct aria wiring between a tab and its panel, and
 * an indicator that is handed the active tab's box in CSS variables so the slide
 * is one transform rather than a class on every chip.
 */
export function ProductShowcase() {
  return (
    <section id="tools-detail" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="flex flex-col gap-5 min-[900px]:flex-row min-[900px]:items-end min-[900px]:justify-between">
          <h2
            className="max-w-[22ch] font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
              lineHeight: 1.12,
              letterSpacing: "-0.028em",
            }}
          >
            {SHOWCASE_HEAD}
          </h2>
          {/* The per-tool pages this used to open are gone. The docs are where
              the long form lives now, and pointing at a room that was
              demolished is worse than pointing at nothing. */}
          <a
            href={DOCS_URL}
            className="shrink-0 text-[13px] text-mark transition-[opacity] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            style={{ transitionDuration: "var(--dur-hover)" }}
          >
            Every tool in the docs
            <span aria-hidden className="pl-1">
              →
            </span>
          </a>
        </div>

        <div data-reveal="panel" style={{ ["--reveal-at" as string]: "80ms" }} className="mt-8">
          <Tabs.Root defaultValue={TOOLS[0].slug}>
            <Tabs.List className="room-tool-list">
              <Tabs.Indicator className="room-tool-indicator" />
              {TOOLS.map((tool) => (
                <Tabs.Tab key={tool.slug} value={tool.slug} className="room-tool-tab">
                  {tool.slug}
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {TOOLS.map((tool) => {
              const Figure = DIAGRAMS[tool.figure];
              return (
                <Tabs.Panel
                  key={tool.slug}
                  value={tool.slug}
                  className="room-tool-panel mt-5 outline-none"
                >
                  <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-12">
                    {/* The words. Widest column, because the question and the
                        sentence under it are what a reader takes away; the code
                        beside it is what they come back for. */}
                    <div className="flex flex-col rounded-xl border border-edge border-t-edge-lit bg-surface p-6 min-[900px]:col-span-5">
                      <p className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
                        {tool.group}
                      </p>
                      <h3 className="mt-3 text-[19px] font-medium leading-snug tracking-[-0.015em] text-ink">
                        {tool.question}
                      </h3>
                      <p className="mt-3 text-[13px] leading-[1.65] text-ink-2">{tool.lead}</p>

                      <p className="mt-6 border-t border-edge pt-4 font-mono text-[11px] leading-[1.55] text-ink-3">
                        Call it {tool.whenToCall.charAt(0).toLowerCase() + tool.whenToCall.slice(1)}
                      </p>
                    </div>

                    {/* The artifact. Two stacked panels rather than one with a
                        divider: the request and the response shape are two
                        different objects and a shared frame implies one
                        document. */}
                    <div className="flex flex-col gap-4 min-[900px]:col-span-4">
                      <div className="overflow-hidden rounded-xl border border-edge border-t-edge-lit">
                        <div className="room-code-bar">
                          <span className="font-mono text-[11px] text-ink-2">{tool.slug}</span>
                          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                            request
                          </span>
                        </div>
                        <pre className="room-code" tabIndex={0}>{tool.call}</pre>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-edge border-t-edge-lit">
                        <div className="room-code-bar">
                          <span className="font-mono text-[11px] text-ink-2">response</span>
                          {/* Named on the page, not just in a source comment.
                              A reader who assumes these are live numbers and
                              later finds out otherwise has been misled by
                              omission. */}
                          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                            shape, not an answer
                          </span>
                        </div>
                        <pre className="room-code" tabIndex={0}>{tool.shape}</pre>
                      </div>
                    </div>

                    {/* The figure. Its own tile at 900px and up, and dropped
                        entirely below that: a 480x340 drawing squeezed under a
                        stack of code panels on a phone is a grey band nobody
                        can read. */}
                    <div className="relative hidden overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface min-[900px]:col-span-3 min-[900px]:block">
                      <Figure id={`showcase-${tool.slug}`} fit="meet" />
                    </div>
                  </div>
                </Tabs.Panel>
              );
            })}
          </Tabs.Root>
        </div>
      </div>
    </section>
  );
}
