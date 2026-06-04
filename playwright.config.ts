import { defineConfig } from '@playwright/test';

// Worktrees often run a side-by-side dev server on a non-default port
// (PORT=3001/3002/...) to avoid clashing with the main directory.
// `PLAYWRIGHT_BASE_URL` lets a one-off run target the worktree's port
// without editing this file. Default stays at :3000 so CI / main runs
// are unchanged.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
