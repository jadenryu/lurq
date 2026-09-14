// Stock footage from Mixkit (Stock Video Free License: commercial use, no attribution).
// The files are large, so they stay out of git; this fetches any that are missing.
import { access, mkdir, writeFile } from "node:fs/promises";

const CLIPS = {
  curve: 49833,
  towers: 49875,
  dusk: 49848,
  highway: 42048,
  spire: 49871,
  street: 41161,
  tower: 49836,
  map: 12748,
  night: 40640,
  horizon: 41375,
};

await mkdir("public/clips", { recursive: true });
for (const [name, id] of Object.entries(CLIPS)) {
  const file = `public/clips/${name}.mp4`;
  if (await access(file).then(() => true, () => false)) continue;
  // The best Mixkit serves for this clip: 4K, then 1080p, then 720p.
  let res;
  for (const quality of [2160, 1080, 720]) {
    res = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-${quality}.mp4`);
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`clip ${name} (${id}): HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${name}`);
}
