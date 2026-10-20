// Playwright config for the "Ngày của Zịt" QC suite.
// Serves the site root on 127.0.0.1:4318 (started and stopped by Playwright's webServer).
import { defineConfig, devices } from '@playwright/test';

const PORT = 4318;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: '.',
  testMatch: /qc-ngay-cua-zit\.spec\.mjs$/,
  outputDir: '.artifacts/test-results',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [
    ['list'],
    ['json', { outputFile: '.artifacts/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // reuseExistingServer is off on purpose: a stale process on the port fails the run instead of being silently reused.
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    cwd: '..',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 15_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium-mobile-375',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
