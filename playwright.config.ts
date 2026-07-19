import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Screenshot-asserties (visueel-publiek.spec.ts): kleine antialiasing-
  // verschillen toestaan, geen semantische afwijkingen.
  expect: {
    // Ruime timeout: fullPage-captures van lange pagina's (design-system)
    // hebben meer dan de standaard 5s nodig om te stabiliseren.
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    // Workstream B draait op de poortrange 3600-3699.
    baseURL: "http://localhost:3600",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobiel",
      // iPhone 14-emulatie op Chromium: het device-profiel wijst standaard
      // naar WebKit, maar de CI-/agent-omgeving levert alleen Chromium
      // (/opt/pw-browsers). Viewport/touch/UA blijven die van iPhone 14.
      use: { ...devices["iPhone 14"], browserName: "chromium" },
      // De visuele publieke suite regelt haar viewports (390/768/1440)
      // zelf binnen de spec en draait alleen in het desktop-project.
      grepInvert: /@visueel/,
    },
  ],
  webServer: {
    command: "npm run start -- --port 3600",
    url: "http://localhost:3600",
    reuseExistingServer: true,
    timeout: 60_000,
    // De e2e- en visuele suites (incl. alle screenshot-baselines) zijn
    // gebouwd op de deterministische fixtures — de openbare site draait in
    // productie op échte data (PUBLIC_DATA_SOURCE-default "direct"), maar
    // hier expliciet op fixtures zodat de baselines stabiel blijven.
    env: { PUBLIC_DATA_SOURCE: "fixtures" },
  },
});
