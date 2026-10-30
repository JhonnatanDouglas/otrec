import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-browser',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start -- --port 3107',
    url: 'http://127.0.0.1:3107',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
