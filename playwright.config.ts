import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false,
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 1000 }, browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 30_000 },
});
