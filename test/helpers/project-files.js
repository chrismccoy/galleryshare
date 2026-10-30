import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config/root.js';

export const NO_GIT_REASON = 'not a git checkout (no .git directory), so there is no file list to scan';

export function projectFiles({ untracked = false } = {}) {
  if (!fs.existsSync(path.join(PROJECT_ROOT, '.git'))) return null;
  const args = ['ls-files', '--cached', ...(untracked ? ['--others', '--exclude-standard'] : []), '-z'];
  const output = execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return output.split('\0').filter((file) => file && fs.existsSync(path.join(PROJECT_ROOT, file)));
}
