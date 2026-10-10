/**
 * Lucide icons (ISC licence), copied from lucide-react's icon nodes so the video
 * draws the same hand-drawn set the site uses, stroke by stroke, without a dependency.
 */
export type IconNode = ["path" | "circle", Record<string, string>][];

export const packageX: IconNode = [
  ["path", { d: "M12 22V12" }],
  ["path", { d: "m16.5 14.5 5 5" }],
  ["path", { d: "m16.5 19.5 5-5" }],
  ["path", { d: "M21 10.5V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.13-.074" }],
  ["path", { d: "M3.29 7 12 12l8.71-5" }],
  ["path", { d: "m7.5 4.27 8.997 5.148" }],
];

export const triangleAlert: IconNode = [
  ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }],
];

export const shieldCheck: IconNode = [
  ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
  ["path", { d: "m9 12 2 2 4-4" }],
];

export const check: IconNode = [["path", { d: "M20 6 9 17l-5-5" }]];

export const arrowRight: IconNode = [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "m12 5 7 7-7 7" }],
];

export const gitCompareArrows: IconNode = [
  ["circle", { cx: "5", cy: "6", r: "3" }],
  ["path", { d: "M12 6h5a2 2 0 0 1 2 2v7" }],
  ["path", { d: "m15 9-3-3 3-3" }],
  ["circle", { cx: "19", cy: "18", r: "3" }],
  ["path", { d: "M12 18H7a2 2 0 0 1-2-2V9" }],
  ["path", { d: "m9 15 3 3-3 3" }],
];
