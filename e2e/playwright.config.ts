import { defineConfig, devices } from "@playwright/test";

import { readEnvironment } from "./config";

const { isCi } = readEnvironment();

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.cache/test-results",
  globalSetup: "./globalSetup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // Every worker starts its own backend container, so keep the count modest.
  workers: isCi ? 2 : 3,
  reporter: isCi
    ? [["github"], ["html", { outputFolder: "./.cache/report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "./.cache/report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
  ],
});
