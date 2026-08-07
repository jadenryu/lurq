import Link from "next/link";
import {
  FAQ_CONTACT_BEFORE,
  FAQ_CONTACT_LINK,
  FAQ_GROUPS,
  FAQ_HEAD,
  FAQ_LABEL,
} from "@/content/faq-groups";

/**
 * Questions, grouped, on the left-heading layout.
 *
 * Built on <details>/<summary> rather than a JS accordion: it opens without
 * hydration, it is keyboard operable for free, and browser find-in-page can
 * reach the answers inside closed items. The first question in the first group
 * ships open so the section is never a wall of shut doors.
 *
 * The group headings on the left are anchors, not a state machine. A reader who
 * clicks "Data" wants to be at the data questions, and scroll is a better answer
 * to that than a tab.
 */
export function Faq() {
  return (
    <section id="faq" className="w-full py-24 min-[900px]:py-32">
      <div className="mx-auto grid w-full max-w-[1180px] gap-12 px-4 min-[900px]:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] min-[900px]:gap-20 min-[768px]:px-6">
        <div className="min-[900px]:sticky min-[900px]:top-28 min-[900px]:self-start">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            {FAQ_LABEL}
          </p>
          <h2
            className="mt-5 font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.028em",
            }}
          >
            {FAQ_HEAD}
          </h2>
          <nav className="mt-8 flex flex-col gap-3">
            {FAQ_GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#faq-${g.id}`}
                className="w-fit text-[14px] text-ink-3 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                style={{ transitionDuration: "var(--dur-hover)" }}
              >
                {g.title}
              </a>
            ))}
          </nav>
          <p className="mt-10 max-w-[34ch] text-[14px] leading-[1.6] text-ink-2">
            {FAQ_CONTACT_BEFORE}{" "}
            <Link
              href="/book-demo"
              className="text-ink underline decoration-edge-lit underline-offset-4 transition-[color,text-decoration-color] hover:decoration-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              style={{ transitionDuration: "var(--dur-hover)" }}
            >
              {FAQ_CONTACT_LINK}
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-col gap-14">
          {FAQ_GROUPS.map((group, gi) => (
            <div key={group.id} id={`faq-${group.id}`} className="scroll-mt-28">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                {group.title}
              </h3>
              <div className="mt-5">
                {group.items.map((item, i) => (
                  <details
                    key={item.q}
                    open={gi === 0 && i === 0}
                    className="room-faq border-t border-edge last:border-b"
                  >
                    <summary className="group flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] text-ink transition-[color] hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark">
                      {item.q}
                      <span
                        aria-hidden
                        className="room-faq-glyph shrink-0 text-ink-3 group-hover:text-ink-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M3 5.5 7 9.5l4-4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </summary>
                    <p className="room-faq-answer max-w-[62ch] pb-6 text-[15px] leading-[1.65] text-ink-2">
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
