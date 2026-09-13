import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// The app's own .env.local, so the runner and the dev server agree on one Clerk
// instance. @clerk/testing reads the unprefixed publishable key name.
loadEnvConfig(__dirname);
process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Not 3000: with reuseExistingServer that would test whatever branch the main
// checkout's dev server happens to be running.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL },
  projects: [
    // Project-based, not globalSetup: clerkSetup's env has to reach the workers.
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "playwright/.clerk/user.json"),
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
