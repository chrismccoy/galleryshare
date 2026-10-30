import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_PORT = Number(process.env.E2E_PORT) || 3310;

export const SETTINGS_ENC_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export const E2E_DIR_ENV = 'GALLERYSHARE_E2E_DIR';

export const E2E_DIR_PREFIX = 'galleryshare-e2e-';

export function removeStaleE2eDirs() {
  let names;
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    const match = name.startsWith(E2E_DIR_PREFIX) && /^(\d+)(?:-|$)/.exec(name.slice(E2E_DIR_PREFIX.length));
    if (!match || isAlive(Number(match[1]))) continue;
    fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true, maxRetries: 2 });
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

export function e2eDir() {
  return process.env[E2E_DIR_ENV] || path.join(os.tmpdir(), `${E2E_DIR_PREFIX}${process.pid}`);
}

export function e2eDbPath(dir) {
  return path.join(dir, 'e2e.sqlite');
}

export function e2eMediaDir(dir) {
  return path.join(dir, 'media');
}

export function e2eTmpDir(dir) {
  return path.join(dir, 'tmp');
}
