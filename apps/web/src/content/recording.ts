/**
 * The hero terminal recording slot.
 *
 * lurq lives inside someone else's editor, so the honest product visual is a
 * terminal: one unbroken take of a coding agent reaching for a package and lurq
 * catching something — an advisory, a typosquat, a peer conflict — then the agent
 * taking the alternative and carrying on.
 *
 * Drop the files in `apps/web/public/media/` and fill this in. Nothing renders
 * while it's empty, which is deliberate: a poster frame for a clip that doesn't
 * exist would be the one invented thing on the page.
 *
 * Recording rules that matter:
 *   - under 40 seconds, real latency, no speed-up — the pauses are what make it
 *     read as real
 *   - no music, no voiceover, no intro card, no cuts
 *   - terminal font 16px minimum (most demos are unreadable because the recorder
 *     was on a 32-inch display)
 *   - autoplay muted, looping, with a visible pause control
 *   - a poster frame that stands on its own in case it never plays
 */
export type Recording = {
  /** Looping muted video. Prefer .webm with an .mp4 sibling. */
  src?: string;
  mp4?: string;
  /** First frame, shown while the video loads and if it never plays. */
  poster?: string;
  /** One line under the clip, in label style. */
  caption?: string;
};

export const heroRecording: Recording = {
  // src: "/media/lurq-catch.webm",
  // mp4: "/media/lurq-catch.mp4",
  // poster: "/media/lurq-catch.jpg",
  // caption: "claude code · adding auth to a next.js app · unedited",
};
