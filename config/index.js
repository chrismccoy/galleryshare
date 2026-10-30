import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { LIMITS, MAX_DISPLAY_NAME, MIN_PASSWORD_LENGTH, TUNABLES } from '../domain/limits.js';
import { DEFAULT_SHARE_THEME, SHARE_THEME_MESSAGE, isShareTheme } from '../domain/share-themes.js';
import { DEFAULT_IMAGE_VIEW, IMAGE_VIEW_MESSAGE, isImageView } from '../domain/image-views.js';
import { deepFreeze } from '../lib/deep-freeze.js';
import { PROJECT_ROOT } from './root.js';
import { tmpDirProblems } from './folder-checks.js';
import { parseKey } from '../lib/secret-box.js';
import { EMAIL_PATTERN, normalizeEmail } from '../lib/email.js';
import { digitsInt } from '../lib/params.js';
import { MS_PER_DAY } from '../lib/time.js';
import { LOG_LEVELS } from '../lib/logger.js';

const MAX_PORT = 65535;

const MAX_DAYS = 3650;

const MAX_RATE_LIMIT_WINDOW_MS = MS_PER_DAY;

const MEMORY_DATABASE = ':memory:';

const FILE_SCHEME = 'file:';

const DEFAULT_HOST = '127.0.0.1';

const DEFAULT_ADMIN_NAME = 'Admin';

const DEFAULT_DATABASE_PATH = './data/galleryshare.sqlite';

const DEFAULT_MEDIA_DIR = './data/media';

const DEFAULT_TMP_DIR = './data/tmp';

const DEFAULT_LOG_DIR = './data/logs';

const INVALID_LOG_LEVEL = `LOG_LEVEL must be ${LOG_LEVELS.slice(0, -1).join(', ')} or ${LOG_LEVELS.at(-1)}.`;


export const SETTING_DEFS = deepFreeze({
  port: { env: 'PORT', defaultValue: 3000, min: 1, max: MAX_PORT },
  sessionDays: { env: 'SESSION_DAYS', defaultValue: 30, min: 1, max: MAX_DAYS },
  publicFormMax: { env: 'RATE_LIMIT_PUBLIC_FORM_MAX', defaultValue: 10, min: 1, max: Number.MAX_SAFE_INTEGER },
  zipMax: { env: 'RATE_LIMIT_ZIP_MAX', defaultValue: 5, min: 1, max: Number.MAX_SAFE_INTEGER },
  windowMs: { env: 'RATE_LIMIT_WINDOW_MS', defaultValue: 900_000, min: 1, max: MAX_RATE_LIMIT_WINDOW_MS },
  trashRetentionDays: { env: 'TRASH_RETENTION_DAYS', defaultValue: 30, min: 1, max: MAX_DAYS },
  activityRetentionDays: { env: 'ACTIVITY_RETENTION_DAYS', defaultValue: 90, min: 1, max: MAX_DAYS },
  logRetentionDays: { env: 'LOG_RETENTION_DAYS', defaultValue: 30, min: 1, max: MAX_DAYS },
});

const SHARE_MAX_ENV = 'RATE_LIMIT_SHARE_MAX';

function envInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = digitsInt(String(value ?? '').trim());
  return parsed !== null && parsed >= min && parsed <= max ? parsed : fallback;
}

const readSetting = (env, def) => envInt(env[def.env], def.defaultValue, def);

const readSettings = (env, defs) =>
  Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, readSetting(env, def)]));

const OFF_WORDS = new Set(['0', 'false', 'no', 'off']);
const ON_WORDS = new Set(['1', 'true', 'yes', 'on']);

const envWord = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const INVALID_SHARE_GRID_TEXT = 'SHARE_GRID_TEXT must be true or false.';

function keySetting(value, fallback, isKey) {
  const word = envWord(value);
  if (word === '') return fallback;
  return isKey(word) ? word : null;
}

function shareThemeSetting(value) {
  return keySetting(value, DEFAULT_SHARE_THEME, isShareTheme);
}

function imageViewSetting(value) {
  return keySetting(value, DEFAULT_IMAGE_VIEW, isImageView);
}

function shareGridTextSetting(value) {
  const word = envWord(value);
  if (OFF_WORDS.has(word)) return false;
  return word === '' || ON_WORDS.has(word) ? true : null;
}

const TRUST_OFF = new Set(['', ...OFF_WORDS]);

const TRUST_ON = new Set([...ON_WORDS].filter((word) => word !== '1'));

function trustSetting(value) {
  const text = String(value ?? '').trim();
  const word = envWord(text);
  if (TRUST_OFF.has(word)) return false;
  if (TRUST_ON.has(word)) return true;
  return digitsInt(text) ?? text;
}

function resolveDatabasePath(value) {
  const raw = (value ?? '').trim();
  if (raw === MEMORY_DATABASE || raw.startsWith(FILE_SCHEME)) return raw;
  return path.resolve(PROJECT_ROOT, raw || DEFAULT_DATABASE_PATH);
}

function resolveDir(value, fallback) {
  const raw = (value ?? '').trim();
  return path.resolve(PROJECT_ROOT, raw || fallback);
}

export function readEnvFile(file = path.join(PROJECT_ROOT, '.env')) {
  try {
    return parseEnv(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const MALFORMED_SECRETS_KEY = 'SETTINGS_ENC_KEY must be 32 bytes, given as 64 hex chars or base64.';


function environment(source, envFile) {
  const base = source ?? process.env;
  return envFile && base.GALLERYSHARE_SKIP_ENV_FILE !== '1' ? { ...readEnvFile(), ...base } : base;
}

export function loadConfig(source, { envFile = source === undefined } = {}) {
  const env = environment(source, envFile);
  const numbers = readSettings(env, SETTING_DEFS);
  const tunables = readSettings(env, TUNABLES);
  const isProduction = env.NODE_ENV === 'production';
  const trustProxy = trustSetting(env.TRUST_PROXY);

  const config = {
    env: env.NODE_ENV ?? 'development',
    isProduction,
    port: numbers.port,
    host: (env.HOST ?? '').trim() || DEFAULT_HOST,
    trustProxy,
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, '') || null,
    session: {
      secret: env.SESSION_SECRET ?? '',
      days: numbers.sessionDays,
      cookieSecure: isProduction || trustProxy !== false || ON_WORDS.has(envWord(env.COOKIE_SECURE)),
    },
    admin: {
      email: normalizeEmail(env.ADMIN_EMAIL) || null,
      password: env.ADMIN_PASSWORD || null,
      name: (env.ADMIN_NAME ?? '').trim() || DEFAULT_ADMIN_NAME,
    },
    secretsKey: parseKey(env.SETTINGS_ENC_KEY),
    secretsKeySet: String(env.SETTINGS_ENC_KEY ?? '').trim() !== '',
    databasePath: resolveDatabasePath(env.DATABASE_PATH),
    mediaDir: resolveDir(env.MEDIA_DIR, DEFAULT_MEDIA_DIR),
    tmpDir: resolveDir(env.TMP_UPLOAD_DIR, DEFAULT_TMP_DIR),
    rateLimit: {
      publicFormMax: numbers.publicFormMax,
      shareMax: envInt(env[SHARE_MAX_ENV], numbers.publicFormMax),
      zipMax: numbers.zipMax,
      windowMs: numbers.windowMs,
    },
    itemsPerPage: tunables.itemsPerPage,
    limits: Object.fromEntries(Object.keys(LIMITS).map((name) => [name, tunables[name]])),
    trash: { retentionDays: numbers.trashRetentionDays },
    activity: { retentionDays: numbers.activityRetentionDays },
    log: {
      dir: resolveDir(env.LOG_DIR, DEFAULT_LOG_DIR),
      retentionDays: numbers.logRetentionDays,
      level: envWord(env.LOG_LEVEL) || 'info',
    },
    shareGridText: shareGridTextSetting(env.SHARE_GRID_TEXT),
    shareTheme: shareThemeSetting(env.SHARE_THEME),
    shareImageView: imageViewSetting(env.SHARE_IMAGE_VIEW),
  };
  return deepFreeze(config);
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function assertConfig(config) {
  const problems = config.secretsKeySet && !config.secretsKey ? [MALFORMED_SECRETS_KEY] : [];
  const dbFile =
    config.databasePath === MEMORY_DATABASE || config.databasePath?.startsWith(FILE_SCHEME)
      ? null
      : config.databasePath;
  problems.push(...tmpDirProblems({ tmpDir: config.tmpDir, mediaDir: config.mediaDir, databaseFile: dbFile }));
  if (config.shareGridText === null) problems.push(INVALID_SHARE_GRID_TEXT);
  if (config.shareTheme === null) problems.push(`SHARE_THEME: ${SHARE_THEME_MESSAGE}`);
  if (config.shareImageView === null) problems.push(`SHARE_IMAGE_VIEW: ${IMAGE_VIEW_MESSAGE}`);
  if (!LOG_LEVELS.includes(config.log?.level)) problems.push(INVALID_LOG_LEVEL);
  if (config.databasePath.startsWith(FILE_SCHEME)) {
    problems.push('DATABASE_PATH must be a file path or :memory:; SQLite file: URIs are not supported.');
  }
  if (config.publicUrl && !isHttpUrl(config.publicUrl)) {
    problems.push('PUBLIC_URL must be an absolute http or https address, such as https://photos.example.com.');
  }

  const { email, password, name } = config.admin ?? {};
  if (name?.length > MAX_DISPLAY_NAME) problems.push(`ADMIN_NAME must be at most ${MAX_DISPLAY_NAME} characters.`);
  if (Boolean(email) !== Boolean(password)) {
    problems.push('ADMIN_EMAIL and ADMIN_PASSWORD must be set together.');
  } else if (email) {
    if (!EMAIL_PATTERN.test(email)) problems.push('ADMIN_EMAIL must be a valid email address.');
    if (!password.trim()) {
      problems.push('ADMIN_PASSWORD must not be only spaces.');
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      problems.push(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  if (config.isProduction) {
    if (!config.session.secret) {
      problems.push('SESSION_SECRET must be set to a unique random value in production.');
    }
    if (!email && !password) {
      problems.push('ADMIN_EMAIL and ADMIN_PASSWORD must be set in production.');
    }
    if (!config.publicUrl) {
      problems.push('PUBLIC_URL must be set in production (the base of invite and reset links).');
    }
  }

  if (problems.length) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
}
