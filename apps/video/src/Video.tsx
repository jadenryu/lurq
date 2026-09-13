import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { Catch, Close, Everywhere, Hook, Upgrade } from "./scenes";

export const FPS = 30;
const FADE = 15;

/** Each scene's length in frames. A fade overlaps two scenes, so it is subtracted once per join. */
const SCENES = [
  { id: "hook", Component: Hook, frames: 120 },
  { id: "catch", Component: Catch, frames: 180 },
  { id: "upgrade", Component: Upgrade, frames: 300 },
  { id: "everywhere", Component: Everywhere, frames: 180 },
  { id: "close", Component: Close, frames: 210 },
];

export const DURATION = SCENES.reduce((sum, s) => sum + s.frames, 0) - FADE * (SCENES.length - 1);

export function LurqVideo() {
  return (
    <TransitionSeries>
      {SCENES.map(({ id, Component, frames }, i) => (
        <Fragment key={id}>
          {i > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />}
          <TransitionSeries.Sequence durationInFrames={frames}>
            <Component />
          </TransitionSeries.Sequence>
        </Fragment>
      ))}
    </TransitionSeries>
  );
}
