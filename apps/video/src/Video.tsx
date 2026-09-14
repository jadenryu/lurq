import { springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, MONO, WORDMARK } from "./brand";
import { Mark, SceneTiming, useUnit } from "./components";
import { End, Everywhere, Guess, Interlude, Meet, Open, Picks, UpgradeShot, VerifyShot } from "./scenes";

export const FPS = 30;
const CUT = 30;

/** Each scene's length in frames. A dissolve overlaps two scenes, so it is subtracted once per join. */
const SCENES = [
  { id: "open", Component: Open, frames: 150 },
  { id: "picks", Component: Picks, frames: 140 },
  { id: "guess", Component: Guess, frames: 210 },
  { id: "meet", Component: Meet, frames: 130 },
  { id: "verify", Component: VerifyShot, frames: 200 },
  { id: "interlude", Component: Interlude, frames: 130 },
  { id: "upgrade", Component: UpgradeShot, frames: 200 },
  { id: "everywhere", Component: Everywhere, frames: 150 },
  { id: "end", Component: End, frames: 190 },
];

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
    interpolate(frame, [40, 70], [0, 0.8], clamp),
    interpolate(frame, [meet - 10, meet + 10, meetEnd, meetEnd + 20], [0.8, 0, 0, 0.8], clamp),
    interpolate(frame, [end - 10, end + 10], [0.8, 0], clamp),
  );
  return (
    <div style={{ position: "absolute", top: 58 * u, right: 70 * u, display: "flex", alignItems: "center", gap: 12 * u, opacity }}>
      <Mark size={28} at={-100} />
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 * u, color: color.ink }}>{WORDMARK}</span>
    </div>
  );
}

export function LurqVideo() {
  // Every join is the same long, soft dissolve: nothing snaps or slides.
  const timing = springTiming({ config: { damping: 200 }, durationInFrames: CUT });
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground }}>
      <TransitionSeries>
        {SCENES.map(({ id, Component, frames }, i) => (
          <Fragment key={id}>
            {i > 0 && <TransitionSeries.Transition presentation={fade()} timing={timing} />}
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
