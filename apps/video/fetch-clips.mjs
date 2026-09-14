// Stock footage from Mixkit (Stock Video Free License: commercial use, no attribution).
// The files are large, so they stay out of git; this fetches any that are missing.
// Each clip is downloaded at the best size Mixkit serves and re-encoded to 1440p:
// headroom for reframing, and still light enough for Studio to play smoothly.
import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

// Two kinds of shot, one story. City (drone and skyline, dusk and night; Mixkit's 4K Austin set
// where it exists) is the scale: the world runs on software. Office (candid, no one posing for the
// camera) is the people: the teams who build it.
const CLIPS = {
  night: 49848,
  tower: 49871,
  aerial: 40640,
  dusk: 41375,
  office: 918,
  screens: 41639,
  typing: 1781,
};

async function fetchClip([name, id]) {
  const file = `public/clips/${name}.mp4`;
  if (await access(file).then(() => true, () => false)) return;
  let res;
  for (const quality of [2160, 1080, 720]) {
    res = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-${quality}.mp4`);
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`clip ${name} (${id}): HTTP ${res.status}`);
  const source = `public/clips/${name}.source.mp4`;
  await writeFile(source, Buffer.from(await res.arrayBuffer()));
  // Remotion ships its own ffmpeg, so this needs nothing installed.
  await run("npx", ["--no-install", "remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", source, "-vf", "scale=-2:1440", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", file]);
  await rm(source);
  console.log(`fetched ${name}`);
}

await mkdir("public/clips", { recursive: true });
await Promise.all(Object.entries(CLIPS).map(fetchClip));
