import { defineConfig, devices } from "@playwright/test";

// Playwright E2E — chromium only, light color scheme (HD-C: E2E light-only).
// A desktop project + the iPhone 13 gate viewport (390×844, DESIGN §6). The
// webServer serves the built bundle; the daemon/TLS wiring for real API calls
// is provided by scripts/web-e2e-preflight.mjs (maintainer-owned) when a story
// names E2E — the bootstrap demo uses a static preview.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.WEB_E2E_BASE_URL ?? "http://127.0.0.1:4173",
    colorScheme: "light",
    httpCredentials: process.env.WEB_E2E_USERNAME && process.env.WEB_E2E_PASSWORD
      ? {
          username: process.env.WEB_E2E_USERNAME,
          password: process.env.WEB_E2E_PASSWORD,
          send: "always",
        }
      : undefined,
    extraHTTPHeaders: process.env.WEB_E2E_USERNAME && process.env.WEB_E2E_PASSWORD
      ? {
          authorization: `Basic ${Buffer.from(
            `${process.env.WEB_E2E_USERNAME}:${process.env.WEB_E2E_PASSWORD}`,
          ).toString("base64")}`,
        }
      : undefined,
    // The preflight (scripts/web-e2e-preflight.mjs) serves the self-signed SU5
    // cert, so the browser must accept it — same posture as the VPN-only daemon.
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // iPhone 13 gate viewport (390×844, DESIGN §6) but chromium engine — the
    // device profile defaults to WebKit; HD-C is chromium-only E2E.
    {
      name: "iphone-13",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.WEB_E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && vite preview --port 4173 --strictPort",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
