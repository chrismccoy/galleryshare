import fs from 'node:fs';
import { E2E_DIR_ENV } from './support/env.js';

export default async function globalTeardown() {
  const dir = process.env[E2E_DIR_ENV];
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  } catch (err) {
    console.warn(`Could not remove ${dir}: ${err.message}`);
  }
}
