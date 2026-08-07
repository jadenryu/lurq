"use client";

import { useEffect, useRef, useState } from "react";

import { PromptBar } from "@/components/site/prompt-bar";
import {
  SESSION_CALLING,
  SESSION_CHIPS,
  SESSION_CLIENT,
  SESSION_CLIENT_MARK,
  SESSION_CONSEQUENCE,
  SESSION_CORRECTION,
  SESSION_DETAIL,
  SESSION_BODY,
  SESSION_HEAD,
  SESSION_LABEL,
  SESSION_NOTES,
  SESSION_PLACEHOLDER,
  SESSION_PROPOSAL,
  SESSION_REQUEST,
  SESSION_RESULT,
  SESSION_TOOL,
  SESSION_TOOL_ARGS,
} from "@/content/agent-session";

/**
 * The install that would have shipped broken, and the call that caught it.
 *
 * A label and one line at the top, then the demonstration. Deliberately no lead
 * paragraph: every other section introduces itself with an eyebrow, a headline
 * and a sentence, and this one spends four seconds showing you the thing, so a
 * paragraph here would be describing what is about to happen anyway.
 *
 * The three notes under the panel are the prose for this section, and they run
 * after the exchange rather than before it: explaining a thing you have just
 * watched is worth the words, explaining one you have not is not.
 *
 * The scroll runs it, not a timer armed by an observer. Every beat is a position
 * on the window's way up the screen: the request types as you bring it in, it
 * goes when you keep going, lurq is called while you are still moving, and the
 * answer lands as the window reaches the middle of the page. Each beat has a
 * floor so a flick of the trackpad cannot skip one, and the whole thing only
 * ever advances, so scrolling back up leaves it where you left it.
 *
 * The window is drawn from the first frame and the composer sits inside it. It
 * used to be a separate box stacked over the space the panel would later fill,
 * which meant the section opened as a small composer above ~570px of held-open
 * black. Same reserved height now, except it reads as an agent window waiting
 * for a request, which is what it is.
 *
 * The steps carry their own timing as --reveal-at, matching the hero's
 * convention, so the schedule reads top to bottom in source order rather than
 * hiding in the stylesheet.
 *
 * Provenance rules live in content/agent-session.ts and are load-bearing: the
 * prose is staged and every version and verdict is read out of a recorded run.
 * The caption that used to say so on the page is gone, but the build-time guard
 * that enforces it is not.
 */
/**
 * Four beats: the request types itself, it is sent, lurq is called, the panel
 * opens with the answer.
 *
 * `calling` exists as its own stage rather than being folded into the panel's
 * own reveal because it is the only moment on the page where the product is
 * doing something. Collapse it and the panel simply appears, which reads as a
 * screenshot fading in.
 */
type Stage = "typing" | "sending" | "calling" | "burst" | "open";

const ORDER = ["typing", "sending", "calling", "burst", "open"] as const;

/**
 * Where each beat starts, in pixels of scrolling through the hold.
 *
 * The window sticks to the middle of the screen and the page stops advancing
 * until the sequence has played, so scrolling is what runs it and running it is
 * what buys you the rest of the page. 0 is the frame it locks.
 *
 * Pixels rather than a fraction of the hold, because the hold does not have a
 * fixed length: it ends when the answer is on screen (see READ_PX), so a
 * fraction of it would be a fraction of a number that is not known yet. 260px
 * is around three wheel notches for the 27 characters of the request.
 *
 * BAND[0] is 0 by definition: the request starts typing on the first pixel.
 */
const BAND = [0, 260, 300, 400] as const;

/**
 * How much longer the window is held after it opens.
 *
 * The hold cannot be one fixed distance. The floors below are in milliseconds
 * and the hold is in pixels, so the exchange costs ~260px of scrolling to a
 * slow reader and ~1160px to someone flicking a trackpad: any single length is
 * either a page that will not move for the first or a sequence that finishes
 * after the window has let go for the second. So the track is laid out long and
 * cut to length the moment the answer lands, which is the same sentence as the
 * requirement: hold until it has played, then one beat to read it on a still
 * screen, then let go.
 */
const READ_PX = 320;

/**
 * The floor under each beat, in ms: how long it holds the screen at minimum,
 * however fast the wheel is turning.
 *
 * Scroll says when a beat may start; this says it cannot be skipped. Without it
 * one flick of a trackpad crosses every band in a single frame and the send, the
 * call and the burst all resolve on the same tick, which is exactly the "the
 * burst never happens" complaint. With it, a fling still plays the whole thing
 * in ~1.5s and a slow scroll lets you sit inside any beat for as long as you
 * like: park in `calling` and the ring keeps spinning until you move.
 *
 * These are the numbers that used to be the timed chain. They are now the lower
 * bound on it rather than the whole schedule.
 */
const FLOOR = {
  /** Beat after the last character, before it goes. */
  typing: 220,
  /** How long the composer sits sent before the call starts. */
  sending: 140,
  /** One turn of the beam, which spins in 0.45s, so the ring completes. */
  calling: 420,
  /**
   * The burst is the one beat that is not scroll-gated: once the composer has
   * come apart there is nothing on screen to hold, so the window opens on its
   * own rather than stranding you in front of an empty one.
   *
   * The longest spark starts 100ms in and flies for up to 540, so the last of
   * the debris is gone by ~640. Opening at 380 means the window begins to fill
   * while the last of it is still in the air: sequential enough to read as
   * burst-then-arrive, overlapped enough that there is no dead frame between.
   */
  burst: 380,
  open: 0,
} as const satisfies Record<Stage, number>;

export function AgentSession() {
  /** The held track, and the thing held on it. Progress is the distance the one
   *  has travelled inside the other, which needs no viewport arithmetic and is
   *  correct on any screen. */
  const pinRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  /** The spacer that gives the track its length, cut short once it is spent. */
  const runRef = useRef<HTMLDivElement>(null);
  /** How far the scroll has given permission to get to. Only ever grows. */
  const [reached, setReached] = useState(0);
  /** Where the sequence actually is, which is `reached` held back by FLOOR. */
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const stage: Stage = ORDER[step];

  // The scroll is the transport. The window locks to the middle of the screen
  // and every beat is a position inside that hold rather than a moment on a
  // clock: the request types as you keep scrolling, it goes when you keep going,
  // the call runs while you are still moving, and the page is only released once
  // the answer is on screen.
  //
  // It only ever advances. Scroll back up after it has played and it stays
  // played: this is a demonstration you have already watched, not a toy that
  // rewinds, and a section that replays itself every time it passes the fold is
  // a section nobody can scroll past.
  useEffect(() => {
    if (step >= ORDER.length - 1) return;
    const pin = pinRef.current;
    const stick = stickRef.current;
    const run = runRef.current;
    if (!pin || !stick || !run) return;

    const finish = () => {
      setTyped(SESSION_REQUEST.length);
      setReached(ORDER.length - 1);
      setStep(ORDER.length - 1);
    };

    // No track, so nothing to run against: the stylesheet has taken the hold
    // away, either under reduce or on a viewport too short to hold anything.
    // Asking why is the stylesheet's business; all this needs to know is that
    // there is no distance to read and the exchange has to be there already.
    //
    // Nothing types, nothing spins, nothing waits. The sequence is presentation,
    // so it has no reduced form to degrade to, it just does not happen.
    if (run.offsetHeight === 0) {
      finish();
      return;
    }

    // Scrolled clean past already (deep link, restored scroll). Nothing below
    // ever runs going up from here, so without this the window would sit there
    // permanently empty.
    if (pin.getBoundingClientRect().bottom < 0) {
      finish();
      return;
    }

    let raf = 0;
    const read = () => {
      raf = 0;
      // How far the stuck element has travelled down its own track: 0 the frame
      // it locks, and it stops growing the frame the track runs out.
      const travel = stick.getBoundingClientRect().top - pin.getBoundingClientRect().top;
      const n = Math.round(Math.min(1, Math.max(0, travel / BAND[1])) * SESSION_REQUEST.length);
      setTyped((prev) => (n > prev ? n : prev));
      const band = BAND.filter((b) => travel >= b).length - 1;
      setReached((prev) => (band > prev ? band : prev));
    };

    // Coalesced to one read per frame. getBoundingClientRect in a raw scroll
    // handler is a layout read per event, and wheel events land faster than
    // frames do.
    const onScroll = () => {
      raf ||= requestAnimationFrame(read);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [step]);

  // One step at a time toward wherever the scroll has got to, and never sooner
  // than the current beat's floor. This is the whole timing model: the scroll
  // decides how far, the floor decides how fast.
  useEffect(() => {
    if (step >= reached) return;
    const id = setTimeout(() => setStep(step + 1), FLOOR[stage]);
    return () => clearTimeout(id);
  }, [step, reached, stage]);

  // The burst is the exception, and the only beat that runs itself: see FLOOR.
  // The window also waits for the composer to be gone rather than crossfading
  // with it. Overlapped, the two read as one thing dissolving into another;
  // sequenced, the request comes apart and then the answer arrives, which is the
  // order the sentence is in.
  useEffect(() => {
    if (stage !== "burst") return;
    const id = setTimeout(() => setStep(ORDER.indexOf("open")), FLOOR.burst);
    return () => clearTimeout(id);
  }, [stage]);

  // The answer is on screen, so the hold has done its job: cut the track to
  // whatever is left plus one reading beat and give the page back.
  //
  // Only ever shorter. Growing it would stretch the document under a reader who
  // is already inside the hold, and a track already behind us is left alone
  // entirely: shortening that moves everything below it up the page, which from
  // where they are standing is the page jumping.
  useEffect(() => {
    if (stage !== "open") return;
    const pin = pinRef.current;
    const stick = stickRef.current;
    const run = runRef.current;
    if (!pin || !stick || !run) return;
    const track = pin.getBoundingClientRect();
    if (track.bottom < 0) return;
    const travel = stick.getBoundingClientRect().top - track.top;
    const cut = Math.round(travel) + READ_PX;
    if (cut < run.offsetHeight) run.style.height = `${cut}px`;
  }, [stage]);

  // And once that last beat is spent, the track goes entirely.
  //
  // A hold that stays after the sequence has played is a hold you have to do
  // again. Scroll back up through it and the window sticks a second time for
  // someone who has already watched the thing it was holding them for, which is
  // not a demonstration any more, it is a page that will not move. Past this
  // point the section is an ordinary one in both directions.
  //
  // Taking the track out moves everything below it up the page by exactly its
  // height, so the scroll position comes down by the same amount in the same
  // frame and nothing on screen moves: the window is at the end of its travel,
  // so it lands back where it already is, and the only document that changed is
  // above the fold and behind the reader. Instant explicitly, because
  // globals.css puts scroll-behavior: smooth on the root and a smooth-animated
  // correction is the jump this is avoiding, drawn out over 300ms.
  useEffect(() => {
    if (stage !== "open") return;
    const pin = pinRef.current;
    const stick = stickRef.current;
    const run = runRef.current;
    if (!pin || !stick || !run) return;

    let raf = 0;
    const check = () => {
      raf = 0;
      const height = run.offsetHeight;
      if (height === 0) return;
      const travel = stick.getBoundingClientRect().top - pin.getBoundingClientRect().top;
      // A pixel of slack: sticky offsets land on fractional values.
      if (travel < height - 1) return;
      window.removeEventListener("scroll", onScroll);
      run.style.height = "0px";
      window.scrollTo({ top: window.scrollY - height, behavior: "instant" });
    };

    const onScroll = () => {
      raf ||= requestAnimationFrame(check);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stage]);

  const burst = stage === "burst" || stage === "open";
  const playing = stage === "open";

  return (
    <section
      id="verify"
      aria-labelledby="verify-title"
      className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32"
    >
      <div
        data-playing={playing ? "true" : undefined}
        className="room-session mx-auto w-full max-w-[880px]"
      >
        {/* The hold. The window sticks to the middle of the screen and the page
            stops moving until the sequence has played, which is the only way the
            scroll can be the transport: if you can scroll straight past it, the
            demonstration is something that happened near you rather than
            something you did. The track's length is --pin-span in tokens.css and
            nothing here needs to know it. */}
        <div ref={pinRef} className="room-session-pin">
          <div ref={stickRef} className="room-session-sticky">
            {/* The heading is held with the window rather than above it.
                Outside the sticky it scrolls away the moment the window locks,
                so the reader spends the whole sequence watching a terminal with
                its own title sliding out from under the nav, and the section
                comes apart into two things that move at different speeds. It is
                one composition, so it is one held block.

                A label and one line, in the same shape #tools uses, and aligned
                to the panel's own left edge rather than centred: the artifact
                below is the section's argument, and a centred headline over a
                left-aligned panel reads as two compositions rather than one. */}
            <div className="mb-8 min-[900px]:mb-10">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
                {SESSION_LABEL}
              </p>
              <h2
                id="verify-title"
                className="mt-4 max-w-[24ch] font-sans font-medium text-ink"
                style={{
                  fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
                  lineHeight: 1.12,
                  letterSpacing: "-0.028em",
                }}
              >
                {SESSION_HEAD}
              </h2>
              {/* The mechanism, in words. Capped at 62ch like every other body
                  paragraph on the page so the measure matches #tools and
                  #sources rather than running the full panel width. */}
              <p className="mt-4 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">
                {SESSION_BODY}
              </p>
            </div>

            <div
              style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
              className="room-session-panel overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
            >
              {/* Title bar, same vocabulary as the drift panel: what you are looking
              at on the left, where it came from on the right. Drawn from the
              first frame along with the window itself, so the space the exchange
              is about to fill is a window rather than a hole. */}
              <div className="flex items-center gap-2.5 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
                <span
                  aria-hidden
                  className="room-session-mark"
                  style={{ ["--mark-src" as string]: `url(${SESSION_CLIENT_MARK})` }}
                />
                <span className="font-mono text-[12px] text-ink">{SESSION_CLIENT}</span>
                <span className="ml-auto font-mono text-[11px] text-ink-3">mcp · lurq</span>
              </div>

              {/* Composer and exchange share one grid cell inside the window, so the
              handover is a crossfade in place: the request comes apart where the
              answer is about to be, rather than above it. The cell takes its
              height from the exchange, which is in the layout from the first
              frame even while invisible, and the composer floats centred in that
              space. Nothing below this section moves at any point. */}
              <div className="room-session-stage">
                <div data-gone={playing ? "true" : undefined} className="room-session-composer">
                  <PromptBar
                    text={SESSION_REQUEST.slice(0, typed)}
                    placeholder={SESSION_PLACEHOLDER}
                    caret={stage === "typing" && typed > 0}
                    beam={stage === "calling"}
                    burst={burst}
                  />

                  {/* Height held from the start, so the composer does not grow by a
                  line at the moment the call starts. */}
                  <p
                    aria-hidden
                    data-on={stage === "calling" ? "true" : undefined}
                    className="room-session-calling"
                  >
                    {SESSION_CALLING}
                  </p>
                </div>

                <div
                  data-open={playing ? "true" : undefined}
                  className="room-session-body px-4 py-6 min-[720px]:px-7 min-[720px]:py-8"
                >
                  {/* 1. The request. */}
                  <p
                    data-step
                    style={{ ["--reveal-at" as string]: "120ms" }}
                    className="room-session-request text-[15px] leading-[1.6] text-ink"
                  >
                    {SESSION_REQUEST}
                  </p>

                  {/* 2. The answer a model gives on its own. Confident, and wrong in a
                   way nothing on the agent's side can detect. */}
                  <p
                    data-step
                    style={{ ["--reveal-at" as string]: "560ms" }}
                    className="mt-5 text-[15px] leading-[1.6] text-ink-2"
                  >
                    {SESSION_PROPOSAL}
                  </p>

                  {/* 3. The call. */}
                  <div
                    data-step
                    style={{ ["--reveal-at" as string]: "980ms" }}
                    className="room-session-call mt-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-3.5 py-2.5 font-mono text-[12px]">
                      {/* A filled dot for a call that ran, in the same vocabulary the
                    verdict dots below use. Without it the header reads as a
                    command someone typed rather than as a tool the agent
                    invoked and got an answer from. */}
                      <span aria-hidden className="room-session-tool-dot" />
                      <span className="text-ink-3">lurq</span>
                      <span aria-hidden className="text-edge-lit">
                        ·
                      </span>
                      <span className="text-ink">{SESSION_TOOL}</span>
                      <span className="text-ink-3">{SESSION_TOOL_ARGS}</span>
                      {/* What the call returned, counted off the run. Arrives with the
                    verdicts rather than with the header: a result printed before
                    the check finishes is a result nobody waited for. */}
                      <span
                        data-step
                        style={{ ["--reveal-at" as string]: "1620ms" }}
                        className="ml-auto whitespace-nowrap pl-3 text-[11px] text-ink-3"
                      >
                        {SESSION_RESULT}
                      </span>
                    </div>

                    <div className="relative px-3.5 py-3">
                      {/* Held until the verdicts land. Not a spinner for its own sake:
                    it is the beat that makes the answer read as arriving rather
                    than as having always been there. */}
                      <p
                        aria-hidden
                        className="room-session-pending font-mono text-[12px] text-ink-3"
                      >
                        checking peer ranges
                      </p>

                      <ul className="room-session-verdicts flex flex-wrap gap-x-5 gap-y-2.5">
                        {SESSION_CHIPS.map((c, i) => (
                          <li
                            key={c.name}
                            style={{ ["--reveal-at" as string]: `${1680 + i * 90}ms` }}
                            className="flex items-center gap-2 font-mono text-[12px]"
                          >
                            <span
                              aria-hidden
                              className="size-1.5 shrink-0 rounded-full"
                              style={{
                                background:
                                  c.status === "conflict" ? "var(--conflict)" : "var(--held)",
                              }}
                            />
                            <span className="text-ink-2">{c.name}</span>
                            <span className="text-ink-3">{c.version}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* 4. The finding, in the product's own words. Quoted rather than
                   paraphrased: this string is the CLI's. */}
                  <p
                    data-step
                    style={{
                      ["--reveal-at" as string]: "2120ms",
                      borderColor: "var(--conflict)",
                    }}
                    className="mt-5 border-l-2 pl-4 font-mono text-[12.5px] leading-[1.65] text-ink-2"
                  >
                    {SESSION_DETAIL}
                  </p>

                  {/* 5. What it would have cost. The finding above is the machine's
                   sentence and reads as one; this is the same fact in the terms
                   a reader already has, and it is what makes the correction
                   below land as a save rather than as a preference. */}
                  <p
                    data-step
                    style={{ ["--reveal-at" as string]: "2340ms" }}
                    className="mt-4 text-[13.5px] leading-[1.6] text-ink-3"
                  >
                    {SESSION_CONSEQUENCE}
                  </p>

                  {/* 6. What the agent does about it. */}
                  <p
                    data-step
                    style={{ ["--reveal-at" as string]: "2600ms" }}
                    className="mt-5 text-[15px] leading-[1.6] text-ink"
                  >
                    {SESSION_CORRECTION}
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* The distance the hold is spent over: see .room-session-run. A real
              element rather than padding on the track, because a sticky child is
              constrained by its parent's content box and padding is not in it. */}
          <div ref={runRef} aria-hidden className="room-session-run" />
        </div>

        {/* The panel read back in plain language, and the only thing in this
            section that does not animate.

            It used to be a second sequence on the same [data-step] clock, timed
            to land after the last line of the exchange. That was wrong twice
            over now the window is held. It runs while the notes are still below
            the fold, so what a reader actually sees is three numbered rules
            waiting at the bottom edge of the hold and then filling in as the
            page lets go, which reads as a separate thing arriving from
            underneath rather than as part of what they just watched. And it is
            an animation you cannot see the start of, which is no animation at
            all.

            So it is simply text. The demonstration is what plays; this is what
            it says, and it is on the page from the first frame. */}
        <ol className="room-session-notes">
          {SESSION_NOTES.map((n) => (
            <li key={n.index}>
              <span className="room-session-note-index">{n.index}</span>
              {/* font-sans explicitly: globals.css puts every h1-h6 on
                  --font-heading, which in this theme is commitMono. That is
                  right for the section headings elsewhere on the page and wrong
                  here, where these sit directly under the panel's own sans prose
                  and are reading the same exchange back. */}
              <h3 className="mt-3 font-sans text-[15px] font-medium leading-[1.4] text-ink">
                {n.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-2">{n.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
