/**
 * Only applies to the CLI (`remotion studio`, `remotion render`); the Node APIs
 * take these options directly. All options: https://remotion.dev/docs/config
 */
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
// A 4K ad: keep compression artifacts out of gradients and fine type.
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);

// `@/` resolves into the web app, so the video reads its headline and install
// command from apps/web/src/content/copy.ts instead of a second copy of the words.
Config.overrideBundlerConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias as Record<string, string> | undefined),
      "@": path.join(process.cwd(), "../web/src"),
    },
  },
}));
