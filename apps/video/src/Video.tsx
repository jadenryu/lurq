import { linearTiming, springTiming, TransitionSeries, type TransitionPresentation, type TransitionTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { flip } from "@remotion/transitions/flip";
import { pushCut } from "@remotion/transitions/push-cut";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, MONO, WORDMARK } from "./brand";
import { LogoMark, SceneTiming, useUnit } from "./components";
import { Agents, CloseUp, End, Everywhere, Flyover, Guess, Meet, Skyline, UpgradeShot, VerifyShot } from "./scenes";

export const FPS = 30;

type Join = { presentation: TransitionPresentation<Record<string, unknown>>; timing: TransitionTiming; frames: number };

const dissolve = (frames: number): Join => ({ presentation: fade() as never, timing: springTiming({ config: { damping: 200 }, durationInFrames: frames }), frames });
/** A punch-in cut with a faint flash, for the beats that turn the story. */
const punch = (): Join => ({ presentation: pushCut({ flashColor: "#ffffff", flashOpacity: 0.18 }) as never, timing: linearTiming({ durationInFrames: 20 }), frames: 20 });
/** A 3D card flip, between two product shots on the same stage. */
const turn = (): Join => ({ presentation: flip({ direction: "from-right", perspective: 2400 }) as never, timing: springTiming({ config: { damping: 200 }, durationInFrames: 34 }), frames: 34 });

/** Each scene's length in frames, and how it hands over to the next one. */
const SCENES = [
  { id: "skyline", Component: Skyline, frames: 150 },
  { id: "agents", Component: Agents, frames: 120, join: dissolve(30) },
  { id: "closeup", Component: CloseUp, frames: 80, join: punch() },
  { id: "guess", Component: Guess, frames: 220, join: dissolve(24) },
  { id: "meet", Component: Meet, frames: 170, join: punch() },
  { id: "verify", Component: VerifyShot, frames: 230, join: dissolve(30) },
  { id: "flyover", Component: Flyover, frames: 110, join: dissolve(30) },
  { id: "upgrade", Component: UpgradeShot, frames: 220, join: turn() },
  { id: "everywhere", Component: Everywhere, frames: 170, join: dissolve(30) },
  { id: "end", Component: End, frames: 220, join: punch() },
];

const cutBefore = (i: number) => SCENES[i].join?.frames ?? 0;
const starts = SCENES.map((_, i) => SCENES.slice(0, i).reduce((sum, s) => sum + s.frames, 0) - SCENES.slice(1, i + 1).reduce((sum, s) => sum + (s.join?.frames ?? 0), 0));
export const DURATION = starts[SCENES.length - 1] + SCENES[SCENES.length - 1].frames;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A small lurq mark in the corner, like a broadcast bug; it steps aside where the brand is the subject. */
function Bug() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const i = SCENES.findIndex((s) => s.id === "meet");
  const meet = starts[i];
  const meetEnd = starts[i + 1] + cutBefore(i + 1);
  const end = starts[SCENES.length - 1];
  const opacity = Math.min(
    interpolate(frame, [50, 80], [0, 0.85], clamp),
    interpolate(frame, [meet - 10, meet + 10, meetEnd, meetEnd + 20], [0.85, 0, 0, 0.85], clamp),
    interpolate(frame, [end - 10, end + 10], [0.85, 0], clamp),
  );
  return (
    <div style={{ position: "absolute", top: 58 * u, right: 70 * u, display: "flex", alignItems: "center", gap: 12 * u, opacity }}>
      <LogoMark size={30} />
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 * u, color: color.ink }}>{WORDMARK}</span>
    </div>
  );
}

export function LurqVideo() {
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground }}>
      <TransitionSeries>
        {SCENES.map(({ id, Component, frames, join }, i) => (
          <Fragment key={id}>
            {join && <TransitionSeries.Transition presentation={join.presentation} timing={join.timing} />}
            <TransitionSeries.Sequence durationInFrames={frames}>
              <SceneTiming.Provider value={{ frames, cut: cutBefore(i + 1 < SCENES.length ? i + 1 : i), last: i === SCENES.length - 1 }}>
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
