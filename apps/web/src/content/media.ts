// ─────────────────────────────────────────────────────────────────────────
// Real product media manifest.
//
// Every product visual on the landing page falls back to a live, animated
// in-browser mock. To replace one with a real screen recording or GIF, drop the
// file in `apps/web/public/media/` and reference it here — NO component changes
// needed. See `apps/web/public/media/README.md` for formats and recording tips.
//
// - `src`    : looping muted <video> (prefer .webm; add an .mp4 sibling too)
// - `gif`    : static GIF/PNG fallback used only when `src` is omitted
// - `poster` : first-frame image shown while the video loads
// ─────────────────────────────────────────────────────────────────────────

export type MediaSlot = {
  src?: string;
  gif?: string;
  poster?: string;
};

// Hero centerpiece: an agent calling lurq mid-task.
export const heroMedia: MediaSlot = {
  // src: "/media/hero-demo.webm",
  // poster: "/media/hero-demo.jpg",
};

// Showcase panels, keyed by surface id (mcp, cli, api, skill, index, search, cache).
export const surfaceMedia: Record<string, MediaSlot> = {
  // mcp: { src: "/media/showcase-mcp.webm", poster: "/media/showcase-mcp.jpg" },
  // cli: { gif: "/media/showcase-cli.gif" },
};
