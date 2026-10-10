# @lurq/video

The lurq marketing video, rendered with [Remotion](https://www.remotion.dev) from the site's own copy, colors, fonts and agent logos. About 31 seconds, in two frames from one story:

- `LurqWide`: 1920×1080, for the site and YouTube
- `LurqSquare`: 1080×1080, for X and LinkedIn

## Commands

```bash
npm run dev            # Remotion Studio: scrub the timeline, tweak, preview
npm run render         # both formats → out/lurq-16x9.mp4, out/lurq-1x1.mp4
npm run render:wide    # just the 16:9 cut
npm run render:square  # just the 1:1 cut
npx remotion still LurqWide out/frame.png --frame=420   # one frame, for a quick look
```

Run them from `apps/video`. `out/` is gitignored.

## What is on screen

| Scene | Frames | Content |
| --- | --- | --- |
| Hook | 120 | An agent decides to `npm install next-auth-session-helpers`, a name that is not on npm |
| Catch | 180 | lurq's real `verify` verdict for it: `✗ NOT A REAL PACKAGE` |
| Upgrade | 300 | lurq's real `check-upgrade` report: `cookie.parse → parseCookie` |
| Everywhere | 180 | "Install it once. It shows up in all of these." and the agent logos |
| Close | 210 | The hero headline, `npx lurqrun`, lurq.run |

Scenes fade into each other over 15 frames (`src/Video.tsx`).

## Keeping it honest and in sync

- **Words.** The headline, install command and logo heading are imported from `apps/web/src/content/copy.ts` through the `@/` alias in `remotion.config.ts`, so changing the site's copy changes the video on its next render.
- **Output.** The terminal lines in `src/scenes.tsx` are lurq's actual output. If the CLI's wording changes, re-run the command and paste the new lines rather than editing them by hand.
- **Look.** Colors mirror `apps/web/src/app/styles/tokens.css` (`src/brand.ts`). Fonts and logos in `public/` are copies from `apps/web`.
- **Frames, not timers.** Everything animates from `useCurrentFrame()`, so every render is identical. Don't use `setTimeout` or CSS transitions in a scene.

Remotion is free for individuals and companies of up to 3 people; see [remotion.pro/license](https://remotion.pro/license) past that.
