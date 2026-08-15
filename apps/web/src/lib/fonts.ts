import localFont from "next/font/local";
import { Roboto_Mono, Inter } from "next/font/google";

// Inter: the dashboard's body/UI face, paired with Geist for headings.
// Scoped to /dashboard in globals.css (`.dashboard-type`) — the marketing route
// keeps its own pairing, which is a deliberate design and not ours to retune.
// next/font downloads at build time and self-hosts the result, so this adds no
// runtime request and no CDN dependency (same mechanism as Roboto_Mono above).
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Roboto Mono (Google): monospaced accents such as the version string.
export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
});

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

// Geist (Vercel, OFL): the single grotesque family. Powers both headings
// (font-heading) and body (font-sans); both tokens map to --font-geist in
// globals.css, so hierarchy comes from weight/size, not a second family.
export const geist = localFont({
  src: "../../fonts/geist/Geist-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist",
});
