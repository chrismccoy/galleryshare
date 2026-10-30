import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PROJECT_ROOT } from './config/root.js';
import base from './playwright.config.js';
import { MOBILE_DEVICE, SCREENSHOT_PROJECTS } from './scripts/shared/screenshot-projects.js';

export default defineConfig({
  ...base,
  testDir: path.join(PROJECT_ROOT, 'test', 'e2e', 'screenshots'),
  testMatch: '**/*.shots.js',
  outputDir: path.join(PROJECT_ROOT, 'test-results', 'screenshots'),
  timeout: 180_000,
  reporter: [['list']],
  projects: [
    {
      name: SCREENSHOT_PROJECTS.desktop,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: SCREENSHOT_PROJECTS.mobile, use: { ...devices[MOBILE_DEVICE] } },
  ],
});
