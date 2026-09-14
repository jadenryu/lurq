import { springTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, MONO, WORDMARK } from "./brand";
import { Mark, SceneTiming, useUnit } from "./components";
import { Agents, End, Everywhere, Guess, Install, Meet, Office, Threat, UpgradeShot, VerifyShot } from "./scenes";

export const FPS = 30;
const CUT = 24;

/** Each scene's length in frames. A transition overlaps two scenes, so it is subtracted once per join. */
const SCENES = [
  { id: "office", Component: Office, frames: 150 },
  { id: "agents", Component: Agents, frames: 150 },
  { id: "guess", Component: Guess, frames: 170 },
  { id: "threat", Component: Threat, frames: 160 },
  { id: "meet", Component: Meet, frames: 120 },
  { id: "verify", Component: VerifyShot, frames: 190 },
  { id: "install", Component: Install, frames: 120 },
  { id: "upgrade", Component: UpgradeShot, frames: 190 },
  { id: "everywhere", Component: Everywhere, frames: 150 },
  { id: "end", Component: End, frames: 190 },
];

// How each scene hands over to the next: dissolves inside the story, slides where the
// film turns from the problem to lurq and from lurq's product shots back to people.
const JOINS: TransitionPresentation<Record<string, unknown>>[] = [
  fade(),
  fade(),
  fade(),
  fade(),
  slide({ direction: "from-bottom" }),
  fade(),
  slide({ direction: "from-right" }),
  fade(),
  fade(),
] as never;

const starts = SCENES.map((_, i) => SCENES.slice(0, i).reduce((sum, s) => sum + s.frames, 0) - CUT * i);
export const DURATION = starts[SCENES.length - 1] + SCENES[SCENES.length - 1].frames;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A small lurq mark in the corner, like a broadcast bug; it steps aside where the brand is the subject. */
function Bug() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const i = SCENES.findIndex((s) => s.id === "meet");
  const meet = starts[i];
  const meetEnd = meet + SCENES[i].frames - CUT;
  const end = starts[SCENES.length - 1];
  const opacity = Math.min(
    interpolate(frame, [40, 70], [0, 0.85], clamp),
    interpolate(frame, [meet - 10, meet + 10, meetEnd, meetEnd + 20], [0.85, 0, 0, 0.85], clamp),
    interpolate(frame, [end - 10, end + 10], [0.85, 0], clamp),
  );
  return (
    <div style={{ position: "absolute", top: 58 * u, right: 70 * u, display: "flex", alignItems: "center", gap: 12 * u, opacity }}>
      <Mark size={28} at={-100} />
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 * u, color: color.ink }}>{WORDMARK}</span>
    </div>
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
      <Bug />
    </AbsoluteFill>
  );
}
