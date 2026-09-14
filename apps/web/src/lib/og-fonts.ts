import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Real Geist, at real weights, for every card this site renders.
 *
 * WITHOUT THIS THE CARDS ARE ALL ONE WEIGHT. `@vercel/og` bundles its own
 * `Geist-Regular.ttf` and uses it for everything, so a card asking for 500 or
 * 700 got Regular with the weight faked — which is why the old card's headline
 * and its install pill were the same colour of grey at a glance, despite one
 * being set 200 units heavier than the other.
 *
 * WHY .ttf AND NOT THE FONTS THE SITE ALREADY SHIPS. Satori reads ttf, otf and
 * woff and NOT woff2, and Geist ships here as a variable woff2 (lib/fonts.ts).
 * Commit Mono is otf, which should work and does not: its parser throws
 * `ReferenceError: ltagTable is not defined` and takes the build down with it,
 * since cards are prerendered. So these two files are static instances cut from
 * the upstream variable font at the only two weights any card asks for:
 *
 *   fonttools varLib.instancer "Geist[wght].ttf" wght=500 -o Geist-500.ttf
 *   fonttools varLib.instancer "Geist[wght].ttf" wght=700 -o Geist-700.ttf
 *
 * Source is google/fonts `ofl/geist` (OFL, same family the site already uses).
 * 88KB each, read once per process at module scope rather than per render.
 *
 * Geist Mono is cut the same way, at 500 only, from google/fonts `ofl/geistmono`
 * (OFL): the builder card sets its labels and readouts in it.
 *
 *   fonttools varLib.instancer "GeistMono[wght].ttf" wght=500 -o GeistMono-500.ttf
 *
 * ponytail: static weights, not the variable axis. Cut another instance
 * when a card genuinely needs a third weight — never reach for the woff2.
 */

/** Loaded at module scope: these never change, and a card should not pay for them. */
const [medium, bold, mono] = await Promise.all([
  readFile(join(process.cwd(), "fonts/geist/Geist-500.ttf")),
  readFile(join(process.cwd(), "fonts/geist/Geist-700.ttf")),
  readFile(join(process.cwd(), "fonts/geist-mono/GeistMono-500.ttf")),
]);

/** Drop into any `ImageResponse`'s `fonts` option. */
export const ogFonts = [
  { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
  { name: "Geist", data: bold, weight: 700 as const, style: "normal" as const },
  { name: "Geist Mono", data: mono, weight: 500 as const, style: "normal" as const },
];
