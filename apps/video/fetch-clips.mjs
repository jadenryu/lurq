// Stock footage from Mixkit (Stock Video Free License: commercial use, no attribution).
// The files are large, so they stay out of git; this fetches any that are missing.
import { access, mkdir, writeFile } from "node:fs/promises";

const CLIPS = { city: 49878, code: 1728, fiber: 47050, hallway: 23282, racks: 23215, map: 12748 };

await mkdir("public/clips", { recursive: true });
for (const [name, id] of Object.entries(CLIPS)) {
  const file = `public/clips/${name}.mp4`;
  if (await access(file).then(() => true, () => false)) continue;
  // 1080p where Mixkit serves it, 720p otherwise.
  let res = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-1080.mp4`);
  if (!res.ok) res = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-720.mp4`);
  if (!res.ok) throw new Error(`clip ${name} (${id}): HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${name}`);
}
