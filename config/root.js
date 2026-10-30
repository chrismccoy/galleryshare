import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VIEWS_DIR = path.join(PROJECT_ROOT, 'views');

export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

export const SCREENSHOTS_PATH = '/screenshots';

export const SCREENSHOTS_DIR = path.join(PUBLIC_DIR, SCREENSHOTS_PATH.slice(1));
