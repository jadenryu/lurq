import { springTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, MONO, WORDMARK } from "./brand";
import { Grain, Mark, progress, SceneTiming, useUnit } from "./components";
import { Adoption, Close, Everywhere, Hallucination, Invent, Malware, Name, Open, Upgrade, Verify } from "./scenes";

export const FPS = 30;
const CUT = 24;

/** Each scene's length in frames. A transition overlaps two scenes, so it is subtracted once per join. */
const SCENES = [
  { id: "open", Component: Open, frames: 135 },
  { id: "adoption", Component: Adoption, frames: 150 },
  { id: "invent", Component: Invent, frames: 115 },
  { id: "hallucination", Component: Hallucination, frames: 160 },
  { id: "malware", Component: Malware, frames: 160 },
  { id: "name", Component: Name, frames: 115 },
  { id: "verify", Component: Verify, frames: 165 },
  { id: "upgrade", Component: Upgrade, frames: 170 },
  { id: "everywhere", Component: Everywhere, frames: 125 },
  { id: "close", Component: Close, frames: 170 },
];

// How each scene hands over to the next. Mostly dissolves; the wipes and the one slide
// mark a turn in the story. All on the same soft spring, so no cut snaps.
const JOINS: TransitionPresentation<Record<string, unknown>>[] = [
  fade(),
  wipe({ direction: "from-left" }),
  fade(),
  fade(),
  wipe({ direction: "from-right" }),
  slide({ direction: "from-bottom" }),
  wipe({ direction: "from-left" }),
  fade(),
  fade(),
] as never;

const starts = SCENES.map((_, i) => SCENES.slice(0, i).reduce((sum, s) => sum + s.frames, 0) - CUT * i);
export const DURATION = starts[SCENES.length - 1] + SCENES[SCENES.length - 1].frames;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A small lurq mark in the corner, like a broadcast bug; it steps aside where the mark is the subject. */
function Bug() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const i = SCENES.findIndex((s) => s.id === "name");
  const name = starts[i];
  const nameEnd = name + SCENES[i].frames - CUT;
  const close = starts[SCENES.length - 1];
  const opacity = Math.min(
    interpolate(frame, [40, 70], [0, 0.8], clamp),
    interpolate(frame, [name - 10, name + 10, nameEnd, nameEnd + 20], [0.8, 0, 0, 0.8], clamp),
    interpolate(frame, [close - 10, close + 10], [0.8, 0], clamp),
  );
  return (
    <div style={{ position: "absolute", top: 58 * u, right: 70 * u, display: "flex", alignItems: "center", gap: 12 * u, opacity }}>
      <Mark size={28} at={-100} />
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 * u, color: color.ink }}>{WORDMARK}</span>
    </div>
  );
}

/** Thin corner brackets and a hairline of progress along the bottom: the frame of a film, not a slide. */
function Hud() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, 8, 60);
  const inset = 36 * u;
  const len = 26 * u * p;
  const line = "1px solid rgba(242,242,238,0.35)";
  const corners = [
    { top: inset, left: inset, borderTop: line, borderLeft: line },
    { top: inset, right: inset, borderTop: line, borderRight: line },
    { bottom: inset, left: inset, borderBottom: line, borderLeft: line },
    { bottom: inset, right: inset, borderBottom: line, borderRight: line },
  ];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {corners.map((c, i) => (
        <div key={i} style={{ position: "absolute", width: len, height: len, ...c }} />
      ))}
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 2 * u, width: `${(frame / DURATION) * 100}%`, background: "rgba(242,242,238,0.25)" }} />
    </AbsoluteFill>
  );
}

export function LurqVideo() {
  const timing = springTiming({ config: { damping: 200 }, durationInFrames: CUT });
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground }}>
      <TransitionSeries>
        {SCENES.map(({ id, Component, frames }, i) => (
          <Fragment key={id}>
            {i > 0 && <TransitionSeries.Transition presentation={JOINS[i - 1]} timing={timing} />}
            <TransitionSeries.Sequence durationInFrames={frames}>
              <SceneTiming.Provider value={{ frames, cut: CUT, last: i === SCENES.length - 1 }}>
                <Component />
              </SceneTiming.Provider>
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
      <Grain />
      <Hud />
      <Bug />
    </AbsoluteFill>
  );
}
