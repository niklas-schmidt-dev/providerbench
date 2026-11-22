import { defineConfig, devices } from "@playwright/test";

// Honor an assigned PORT (e.g. from `portless run`) so parallel checkouts
// never collide; 3100 is only the standalone default.
const port = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // The build under test is the published dataset plus the synthetic reports
  // in e2e/fixtures/reports: categories the site has no code for, so the
  // tests can see a page lay itself out from reports alone.
  webServer: {
    command:
      `env NEXT_TELEMETRY_DISABLED=1 PROVIDERBENCH_DATA_OVERLAY=e2e/fixtures/reports bun run build && bun run start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
