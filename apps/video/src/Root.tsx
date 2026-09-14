import { Composition } from "remotion";
import { DURATION, FPS, LurqVideo } from "./Video";

/** One story, two frames, both 4K: 16:9 for the site and YouTube, 1:1 for X and LinkedIn. */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="LurqWide" component={LurqVideo} durationInFrames={DURATION} fps={FPS} width={3840} height={2160} />
      <Composition id="LurqSquare" component={LurqVideo} durationInFrames={DURATION} fps={FPS} width={2160} height={2160} />
    </>
  );
};
