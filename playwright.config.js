import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 180000, workers: 2,
  reporter: [['list'], ['json', { outputFile: 'qa-artifacts/playwright-results.json' }]],
  use: { baseURL: process.env.QA_BASE_URL || 'http://127.0.0.1:8798', headless: true, actionTimeout: 10000, navigationTimeout: 15000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
