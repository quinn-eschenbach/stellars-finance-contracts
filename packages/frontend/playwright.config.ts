import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright runs every spec against a Vite dev server started with
 * `VITE_E2E=1`. That env flag flips the `@stellar/freighter-api` alias in
 * `vite.config.ts` to our `e2e/fixtures/freighter-mock.ts` stub, so the
 * frontend wires the wallet without trying to reach a real extension.
 *
 * Network traffic is fully mocked at two layers:
 *   - REST: Playwright `page.route("**\/api/**")` (set up per-test in
 *     `e2e/fixtures/api.ts`).
 *   - Wallet state: `addInitScript(...)` seeds `window.__freighterE2E` so
 *     `getAddress`, `isConnected`, etc resolve canned values.
 *
 * Transactions are not submitted to a real RPC; tests that exercise the
 * sign+send path assert on the signTx log rather than on-chain inclusion.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `pnpm dev` already loads dotenv from the workspace root; we still
    // forward VITE_E2E explicitly so the alias swap fires.
    command: `VITE_E2E=1 pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_E2E: "1" },
  },
});
