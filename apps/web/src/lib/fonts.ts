import localFont from "next/font/local";
import { Roboto_Mono } from "next/font/google";

// Roboto Mono (Google) — monospaced accents such as the version string.
export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
});

// Supreme (Fontshare) — variable font, weights 100–800.
// Exposed as --font-sans so shadcn / Tailwind's `font-sans` resolves to Supreme app-wide.
export const supreme = localFont({
  src: "../../fonts/supreme/Supreme-Variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-sans",
});
