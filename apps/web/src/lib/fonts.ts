import localFont from "next/font/local";

// Commit Mono: used for the hero display heading (bold = 700).
export const commitMono = localFont({
  src: [
    {
      path: "../../fonts/commit_mono/CommitMono-400-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/commit_mono/CommitMono-400-Italic.otf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../fonts/commit_mono/CommitMono-700-Regular.otf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/commit_mono/CommitMono-700-Italic.otf",
      weight: "700",
      style: "italic",
    },
  ],
  display: "swap",
  variable: "--font-commit-mono",
});

// Geist (Vercel, OFL): the only grotesque in the bundle. Headings and body on
// both surfaces, so hierarchy comes from weight and size rather than a second
// family. Inter and Roboto Mono used to sit alongside it: Inter ran the
// dashboard body until it was collapsed onto Geist, and Roboto Mono was
// declared, attached to <html> and referenced by nothing at all, which meant
// every visitor downloaded a face no rule could ever select.
export const geist = localFont({
  src: "../../fonts/geist/Geist-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist",
});
