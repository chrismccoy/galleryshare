import { E2E_DIR_ENV, e2eDir, removeStaleE2eDirs } from './support/env.js';

export default async function globalSetup() {
  removeStaleE2eDirs();
  process.env[E2E_DIR_ENV] = e2eDir();
}
