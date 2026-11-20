import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "off",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile/ },
    { name: "celular", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: `node e2e/prepare-db.mjs && vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    env: { PT_STATE_DIR: ".wrangler/e2e" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
