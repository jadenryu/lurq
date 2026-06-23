import localFont from "next/font/local";
import { Roboto_Mono } from "next/font/google";

// Roboto Mono (Google) – monospaced accents such as the version string.
export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
});

// Commit Mono – used for the hero display heading (bold = 700).
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

// Supreme (Fontshare) – variable font, weights 100–800.
// Exposed as --font-sans so shadcn / Tailwind's `font-sans` resolves to Supreme app-wide.
export const supreme = localFont({
  src: "../../fonts/supreme/Supreme-Variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-sans",
});
