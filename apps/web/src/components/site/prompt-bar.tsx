/**
 * The composer the request is typed into, above the session panel.
 *
 * It is a drawing of an agent composer, not one. There is no input, no focus
 * ring and nothing to click: the request types itself, the beam runs while lurq
 * is called, and the panel below opens with the answer. A focusable box that
 * discarded whatever you typed would be a worse lie than an obvious animation,
 * and the caption under the section already says the request is staged.
 *
 * The beam is the conic-gradient border from `.room-chip`, not a dependency. It
 * spins on --bloom, the same two stops as the hero blooms and the condensed nav
 * rim, so the accent on this page comes from one place.
 */

/** The three icons, inline. Three paths is not worth an icon dependency. */
function AtIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M10.4 5.6v3a1.8 1.8 0 1 0 3.6 0V8a6 6 0 1 0-2.35 4.76M10.4 8a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 6.5 8 9.5l3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 12.7V3.3M12.7 8 8 3.3 3.3 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A pill in the composer chrome. Decorative: these are not controls. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 font-sans text-[11.5px] text-ink-2">
      {children}
    </span>
  );
}

/**
 * The debris. Small white circles that leave from where the composer was.
 *
 * Generated once at module scope with a plain integer LCG rather than
 * Math.random, because this renders on the server too and a fresh number per
 * render is a hydration mismatch. Multiply-add on a seed below 2^32 stays exact
 * in a double, so every value here is bit-identical wherever it runs, and each
 * one is rounded before it reaches a style string so the two sides stringify the
 * same way.
 *
 * Scattered across the box rather than fired from its centre: debris comes off
 * the whole surface of a thing that breaks, and a single origin reads as a
 * firework instead.
 */
const SPARK_COUNT = 34;

const SPARKS = (() => {
  let seed = 20260807;
  /** [0,1), exact and portable. */
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const round = (n: number, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

  return Array.from({ length: SPARK_COUNT }, () => {
    const angle = rand() * Math.PI * 2;
    // Squared so most land close and a few carry, which is what makes it read as
    // debris rather than as a ring expanding.
    //
    // Reach is deliberately short. At 270px the sparks cleared the composer's
    // footprint entirely and spent half a second drifting in open space with
    // nothing left on screen that they had come off, which reads as a starfield.
    // Staying inside roughly one box-width keeps them attached to the thing that
    // broke.
    // Vertical reach is cut harder than horizontal: the composer now sits inside
    // the agent window, which clips, and there is more room to either side of it
    // than there is above and below.
    const reach = 30 + rand() ** 2 * 105;
    return {
      left: round(4 + rand() * 92),
      top: round(6 + rand() * 88),
      // 2.2-5.4px read as dust on a 560px box: technically animating, visually
      // noise. The debris has to be the size of something that came off the
      // thing that broke.
      size: round(3.4 + rand() * 4.6),
      dx: round(Math.cos(angle) * reach),
      dy: round(Math.sin(angle) * reach * 0.62),
      delay: Math.round(rand() * 100),
      // Slow enough to watch. The starfield problem was the distance, not the
      // duration, so the fix was to shorten the reach and let each spark take its
      // time covering it. The whole field is down by a third with the rest of the
      // sequence: the longest spark now lands at ~640ms, and the window opens
      // over the tail of it at 480.
      dur: 340 + Math.round(rand() * 200),
    };
  });
})();

export function PromptBar({
  text,
  placeholder,
  caret,
  beam,
  burst,
}: {
  /** How much of the request has been typed so far. */
  text: string;
  placeholder: string;
  /** Blinking block after the text. Off once the request is away. */
  caret: boolean;
  /** Spin the border. On while lurq is being called. */
  beam: boolean;
  /** Break it apart. The last thing that happens before the panel opens. */
  burst: boolean;
}) {
  return (
    // No dim once the request is sent. There was one, to hand the floor to the
    // panel, but the panel does not exist yet at that point: all it did was play
    // the burst at half strength behind a veil.
    <div
      aria-hidden
      data-beam={beam ? "true" : undefined}
      data-burst={burst ? "true" : undefined}
      className="room-beam room-composer mx-auto w-full max-w-[560px]"
    >
      <div className="room-composer-shell flex h-[128px] flex-col rounded-[19px] bg-surface p-2.5">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <AtIcon />
        </span>

        {/* Fixed height rather than growing with the text: a composer that
            resizes as the request types pushes the whole page down one line at a
            time, which reads as a layout bug. */}
        <p className="px-1 pt-3 text-[14px] leading-[1.5] text-ink">
          {text || <span className="text-ink-3">{placeholder}</span>}
          {caret ? <span className="room-caret" /> : null}
        </p>

        <div className="mt-auto flex items-center gap-2">
          <Chip>
            Agent
            <ChevronIcon />
          </Chip>
          <Chip>
            Auto
            <ChevronIcon />
          </Chip>
          <span className="ml-auto inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-ink-2">
            <ArrowUpIcon />
          </span>
        </div>
      </div>

      {/* The debris, over the top of the shell and outside its rounding so a
          spark can travel past the corner. Mounted from the first frame at zero
          opacity rather than switched in on burst: 34 nodes arriving in the same
          frame they are asked to animate is a frame of layout in the middle of
          the one moment that has to be smooth. */}
      <div className="room-sparks">
        {SPARKS.map((s, i) => (
          <span
            key={i}
            className="room-spark"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              ["--sk-dx" as string]: `${s.dx}px`,
              ["--sk-dy" as string]: `${s.dy}px`,
              ["--sk-delay" as string]: `${s.delay}ms`,
              ["--sk-dur" as string]: `${s.dur}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
