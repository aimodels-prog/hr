import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const isWindows = process.platform === "win32";
const localChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const configuredBrowser =
  process.env["VIA_HR_E2E_BROWSER_EXECUTABLE"]?.trim() ||
  (isWindows && existsSync(localChrome) ? localChrome : undefined);
const webServerCommand =
  process.env["VIA_HR_E2E_WEB_SERVER_COMMAND"]?.trim() ||
  `${isWindows ? "npm.cmd" : "npm"} run dev -- --host 127.0.0.1 --port 4173`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    ...(configuredBrowser ? { launchOptions: { executablePath: configuredBrowser } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...process.env,
      VIA_HR_ORGANISATION_ID:
        process.env.VIA_HR_ORGANISATION_ID ?? "aa98aa96-b498-5ca8-8d0d-da19cd34c176",
      // Browser acceptance deliberately performs many rapid role changes against one loopback IP.
      // Nginx supplies the production perimeter limit; this value prevents the isolated test
      // harness from confusing its own high-volume setup with a real abusive client.
      VIA_HR_MUTATION_RATE_LIMIT: process.env.VIA_HR_E2E_RATE_LIMIT ?? "10000",
      VIA_HR_READ_RATE_LIMIT: process.env.VIA_HR_E2E_RATE_LIMIT ?? "10000",
    },
  },
});
