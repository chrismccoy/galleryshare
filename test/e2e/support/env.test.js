import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from '../../../config/root.js';
import { E2E_DIR_ENV, E2E_DIR_PREFIX, e2eDbPath, e2eDir, removeStaleE2eDirs } from './env.js';
import globalSetup from '../global-setup.js';
import globalTeardown from '../global-teardown.js';
import { tempDir } from '../../helpers/temp.js';

const NO_SUCH_PID = 2_147_483_647;

const savedEnv = process.env[E2E_DIR_ENV];

afterEach(() => {
  if (savedEnv === undefined) delete process.env[E2E_DIR_ENV];
  else process.env[E2E_DIR_ENV] = savedEnv;
});

test('e2eDir returns GALLERYSHARE_E2E_DIR when it is set, without creating anything', () => {
  const dir = path.join(os.tmpdir(), `${E2E_DIR_PREFIX}test-not-created`);
  process.env[E2E_DIR_ENV] = dir;
  assert.equal(e2eDir(), dir);
  assert.equal(fs.existsSync(dir), false);
});

test('e2eDir without GALLERYSHARE_E2E_DIR names a per-process folder and neither creates it nor sets the variable', () => {
  delete process.env[E2E_DIR_ENV];
  const dir = e2eDir();
  assert.equal(dir, path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${process.pid}`));
  assert.equal(fs.existsSync(dir), false);
  assert.equal(process.env[E2E_DIR_ENV], undefined);
  assert.equal(e2eDir(), dir, 'the same folder on every call');
  assert.equal(e2eDbPath(dir), path.join(dir, 'e2e.sqlite'));
});

test('removeStaleE2eDirs clears folders of exited processes (old and new names) and keeps those of live ones', (t) => {
  const exitedPid = NO_SUCH_PID;
  const staleOld = tempDir(t, `${E2E_DIR_PREFIX}${exitedPid}-`);
  const staleNew = path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${exitedPid}`);
  fs.mkdirSync(staleNew, { recursive: true });
  t.after(() => fs.rmSync(staleNew, { recursive: true, force: true }));
  const live = tempDir(t, `${E2E_DIR_PREFIX}${process.pid}-`);
  removeStaleE2eDirs();
  assert.equal(fs.existsSync(staleOld), false);
  assert.equal(fs.existsSync(staleNew), false);
  assert.equal(fs.existsSync(live), true);
});

test('the global setup clears stale folders and shares the run folder through GALLERYSHARE_E2E_DIR', async (t) => {
  const exitedPid = NO_SUCH_PID;
  const stale = tempDir(t, `${E2E_DIR_PREFIX}${exitedPid}-`);
  delete process.env[E2E_DIR_ENV];
  await globalSetup();
  assert.equal(process.env[E2E_DIR_ENV], path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${process.pid}`));
  assert.equal(fs.existsSync(stale), false);
});

test('loading playwright.config.js creates no folder and sets no variable', () => {
  const env = { ...process.env };
  delete env[E2E_DIR_ENV];
  const script = [
    "const { default: config } = await import('./playwright.config.js');",
    'console.log(JSON.stringify({',
    '  pid: process.pid,',
    `  set: process.env.${E2E_DIR_ENV} ?? null,`,
    `  appDir: config.webServer[0].env.${E2E_DIR_ENV},`,
    `  globalSetup: config.globalSetup,`,
    '}));',
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.equal(out.set, null, 'the config leaves the environment alone');
  assert.equal(out.appDir, path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${out.pid}`));
  assert.equal(fs.existsSync(out.appDir), false, 'the config creates no folder');
  assert.equal(out.globalSetup, path.join(PROJECT_ROOT, 'test', 'e2e', 'global-setup.js'));
});

test('global teardown removes the directory in GALLERYSHARE_E2E_DIR and ignores an unset one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${process.pid}-`));
  fs.writeFileSync(path.join(dir, 'e2e.sqlite'), '');
  process.env[E2E_DIR_ENV] = dir;
  await globalTeardown();
  assert.equal(fs.existsSync(dir), false);
  delete process.env[E2E_DIR_ENV];
  await globalTeardown();
});
