import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PROJECT_ROOT } from './config/root.js';
import { ADMIN } from './test/e2e/support/accounts.js';
import {
  APP_PORT,
  E2E_DIR_ENV,
  SETTINGS_ENC_KEY,
  e2eDbPath,
  e2eDir,
  e2eMediaDir,
  e2eTmpDir,
} from './test/e2e/support/env.js';
import { MOBILE_DEVICE } from './scripts/shared/screenshot-projects.js';

const E2E_DIR = e2eDir();

const baseURL = `http://127.0.0.1:${APP_PORT}`;

const HOST_VARS = [
  'PATH',
  'HOME',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'TEMP',
  'TMP',
];

const hostEnv = Object.fromEntries(
  HOST_VARS.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
);

const appEnv = {
  ...hostEnv,
  GALLERYSHARE_SKIP_ENV_FILE: '1',
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(APP_PORT),
  PUBLIC_URL: '',
  TRUST_PROXY: '',
  COOKIE_SECURE: 'false',
  SESSION_SECRET: 'e2e-session-secret-not-for-production-use-0123456789',
  SETTINGS_ENC_KEY,
  ADMIN_EMAIL: ADMIN.email,
  ADMIN_PASSWORD: ADMIN.password,
  ADMIN_NAME: ADMIN.name,
  [E2E_DIR_ENV]: E2E_DIR,
  DATABASE_PATH: e2eDbPath(E2E_DIR),
  MEDIA_DIR: e2eMediaDir(E2E_DIR),
  TMP_UPLOAD_DIR: e2eTmpDir(E2E_DIR),
  RATE_LIMIT_PUBLIC_FORM_MAX: '100000',
  RATE_LIMIT_SHARE_MAX: '100000',
  RATE_LIMIT_ZIP_MAX: '100000',
};

const MOBILE_SPECS = '**/mobile.spec.js';

export default defineConfig({
  testDir: path.join(PROJECT_ROOT, 'test', 'e2e'),
  testMatch: '**/*.spec.js',
  outputDir: path.join(PROJECT_ROOT, 'test-results'),
  globalSetup: path.join(PROJECT_ROOT, 'test', 'e2e', 'global-setup.js'),
  globalTeardown: path.join(PROJECT_ROOT, 'test', 'e2e', 'global-teardown.js'),

  timeout: 45_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    { name: 'chromium', testIgnore: MOBILE_SPECS, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testMatch: MOBILE_SPECS, use: { ...devices[MOBILE_DEVICE] } },
  ],

  webServer: [
    {
      command: 'npm run build:css && node test/e2e/start-app.js',
      url: `${baseURL}/login`,
      env: appEnv,
      cwd: PROJECT_ROOT,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
