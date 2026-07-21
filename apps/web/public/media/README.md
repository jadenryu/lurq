# Landing page product media

Real screen recordings, GIFs, and posters for the marketing site live here.

Every product visual on the landing page ships with a live, animated in-browser
mock, so the page looks finished today. To replace any mock with a real clip,
drop the file in this folder and reference it in the media manifest at
[`src/content/media.ts`](../../src/content/media.ts) — **no component changes
needed.**

## How the slots map

| Slot | Manifest key | Rendered by |
| --- | --- | --- |
| Hero centerpiece (agent calling lurq) | `heroMedia` | [`hero-demo.tsx`](../../src/components/visuals/hero-demo.tsx) |
| Showcase panels (per surface) | `surfaceMedia[<id>]` | [`section-showcase.tsx`](../../src/components/sections/section-showcase.tsx) |

Showcase surface ids: `mcp`, `cli`, `api`, `skill`, `index`, `search`, `cache`.

Resolution order per slot: `src` (video) → `gif` → animated mock.

## Example

```ts
// src/content/media.ts
export const heroMedia = {
  src: "/media/hero-demo.webm",
  poster: "/media/hero-demo.jpg",
};

export const surfaceMedia = {
  mcp: { src: "/media/showcase-mcp.webm", poster: "/media/showcase-mcp.jpg" },
  cli: { gif: "/media/showcase-cli.gif" },
};
```

Paths are web-absolute from `public/`, so `public/media/hero-demo.webm` is
referenced as `/media/hero-demo.webm`.

## Formats & specs

- **Aspect:** 16:9 (matches the frames). ~1600x900 is plenty.
- **Video:** prefer `.webm` (VP9); the `<video>` is `autoPlay muted loop
  playsInline`, so keep clips short (5–12s) and seamless. Add an `.mp4` (H.264)
  sibling with the same name for Safari if needed.
- **Poster:** a JPG/PNG of the first frame, shown while the video loads.
- **GIF:** only when a video is impractical; keep under ~3 MB.
- Keep total weight lean — these autoplay on the homepage.

## Suggested filenames

```
hero-demo.webm / hero-demo.mp4 / hero-demo.jpg
showcase-mcp.webm / showcase-mcp.jpg
showcase-cli.webm  / showcase-cli.jpg
showcase-api.webm  ...
```

## Recording tips (macOS)

1. Record the real agent/CLI at a fixed window size (Cmd+Shift+5, or a tool
   like Kap for direct GIF/MP4).
2. Trim to a tight, loopable segment.
3. Convert to web-friendly formats with ffmpeg:

```bash
# MP4 -> looping VP9 webm
ffmpeg -i raw.mov -c:v libvpx-vp9 -b:v 0 -crf 32 -an hero-demo.webm

# MP4 (H.264) sibling for Safari
ffmpeg -i raw.mov -c:v libx264 -crf 23 -pix_fmt yuv420p -an hero-demo.mp4

# First-frame poster
ffmpeg -i raw.mov -vframes 1 hero-demo.jpg
```
