import { linearTiming, springTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { iris } from "@remotion/transitions/iris";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, WORDMARK } from "./brand";
import { Mark, useUnit } from "./components";
import { Adoption, Close, Everywhere, Hallucination, Invent, Malware, Name, Open, Upgrade, Verify } from "./scenes";

export const FPS = 30;
const CUT = 14;

/** Each scene's length in frames. A transition overlaps two scenes, so it is subtracted once per join. */
const SCENES = [
  { id: "open", Component: Open, frames: 84 },
  { id: "adoption", Component: Adoption, frames: 84 },
  { id: "invent", Component: Invent, frames: 72 },
  { id: "hallucination", Component: Hallucination, frames: 90 },
  { id: "malware", Component: Malware, frames: 90 },
  { id: "name", Component: Name, frames: 66 },
  { id: "verify", Component: Verify, frames: 90 },
  { id: "upgrade", Component: Upgrade, frames: 96 },
  { id: "everywhere", Component: Everywhere, frames: 78 },
  { id: "close", Component: Close, frames: 100 },
];

const starts = SCENES.map((_, i) => SCENES.slice(0, i).reduce((sum, s) => sum + s.frames, 0) - CUT * i);
export const DURATION = starts[SCENES.length - 1] + SCENES[SCENES.length - 1].frames;

/** A small lurq bug in the corner, like a broadcast mark; it steps aside where the mark is the subject. */
function Bug() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const name = starts[SCENES.findIndex((s) => s.id === "name")];
  const close = starts[SCENES.length - 1];
  const opacity = Math.min(
    interpolate(frame, [20, 34], [0, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [name - 6, name + 4, name + 62, name + 72], [0.85, 0, 0, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [close - 6, close + 4], [0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <div style={{ position: "absolute", top: 54 * u, right: 64 * u, display: "flex", alignItems: "center", gap: 12 * u, opacity }}>
      <Mark size={30} at={-100} />
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 28 * u, color: color.ink }}>{WORDMARK}</span>
    </div>
  );
}

export function LurqVideo() {
  const { width, height } = useVideoConfig();
  // A different cut at every join, all short and eased, none of them decorative.
  const smooth = springTiming({ config: { damping: 200 }, durationInFrames: CUT });
  const joins: { presentation: TransitionPresentation<Record<string, unknown>>; timing: ReturnType<typeof linearTiming> }[] = [
    { presentation: fade(), timing: linearTiming({ durationInFrames: CUT }) },
    { presentation: slide({ direction: "from-right" }), timing: smooth },
    { presentation: wipe({ direction: "from-bottom" }), timing: smooth },
    { presentation: fade(), timing: linearTiming({ durationInFrames: CUT }) },
    { presentation: iris({ width, height }), timing: smooth },
    { presentation: slide({ direction: "from-bottom" }), timing: smooth },
    { presentation: wipe({ direction: "from-right" }), timing: smooth },
    { presentation: fade(), timing: linearTiming({ durationInFrames: CUT }) },
    { presentation: slide({ direction: "from-left" }), timing: smooth },
  ] as never;
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground }}>
      <TransitionSeries>
        {SCENES.map(({ id, Component, frames }, i) => (
          <Fragment key={id}>
            {i > 0 && <TransitionSeries.Transition presentation={joins[i - 1].presentation} timing={joins[i - 1].timing} />}
            <TransitionSeries.Sequence durationInFrames={frames}>
              <Component />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
      <Bug />
    </AbsoluteFill>
  );
}
