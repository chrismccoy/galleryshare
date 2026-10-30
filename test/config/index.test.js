import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_DEFS, loadConfig, assertConfig, readEnvFile } from '../../config/index.js';
import { MAX_DISPLAY_NAME, TUNABLES } from '../../domain/limits.js';
import { PROJECT_ROOT } from '../../config/root.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_ADMIN } from '../helpers/accounts.js';
import { tempDir } from '../helpers/temp.js';

const PROD_ADMIN = { ADMIN_EMAIL: ENV_ADMIN.email, ADMIN_PASSWORD: ENV_ADMIN.password, PUBLIC_URL: 'https://a.test' };

test('an empty environment gives the documented defaults (port, host, session, database, rate limits)', () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.session.days, 30);
  assert.equal(c.databasePath, path.join(PROJECT_ROOT, 'data', 'galleryshare.sqlite'));
  assert.deepEqual(c.rateLimit, { publicFormMax: 10, shareMax: 10, zipMax: 5, windowMs: 900000 });
  assert.equal('maxUploadBytes' in c, false);
  assert.equal(c.isProduction, false);
  assert.equal(c.session.cookieSecure, false);
});

test('production requires secret', () => {
  assert.throws(() => assertConfig(loadConfig({ NODE_ENV: 'production' })), /SESSION_SECRET/);
});

test('production without SETTINGS_ENC_KEY does not throw', () => {
  assert.doesNotThrow(() => assertConfig(loadConfig({ ...PROD_ADMIN, NODE_ENV: 'production', SESSION_SECRET: 's' })));
});

test('production with secret and valid key passes', () => {
  const env = { ...PROD_ADMIN, NODE_ENV: 'production', SESSION_SECRET: 's', SETTINGS_ENC_KEY: 'a'.repeat(64) };
  assert.doesNotThrow(() => assertConfig(loadConfig(env)));
  assert.equal(loadConfig(env).session.cookieSecure, true);
});

test('a SETTINGS_ENC_KEY that is neither 64 hex nor 32-byte base64 is refused', () => {
  assert.throws(() => assertConfig(loadConfig({ SETTINGS_ENC_KEY: 'short' })), /SETTINGS_ENC_KEY/);
});

test('enc key accepts 64 hex or 32-byte base64', () => {
  const hex = 'ab'.repeat(32);
  const b64 = Buffer.alloc(32, 7).toString('base64');
  assert.doesNotThrow(() => assertConfig(loadConfig({ SETTINGS_ENC_KEY: hex })));
  assert.doesNotThrow(() => assertConfig(loadConfig({ SETTINGS_ENC_KEY: b64 })));
  const b64short = Buffer.alloc(16, 7).toString('base64');
  assert.throws(() => assertConfig(loadConfig({ SETTINGS_ENC_KEY: b64short })), /SETTINGS_ENC_KEY/);
});

test('trustProxy makes cookies secure', () => {
  const c = loadConfig({ TRUST_PROXY: '1' });
  assert.equal(c.trustProxy, 1);
  assert.equal(c.session.cookieSecure, true);
});

test('PORT and PUBLIC_URL from the environment override the defaults; a trailing slash is dropped', () => {
  const c = loadConfig({ PORT: '8080', PUBLIC_URL: 'https://a.test/' });
  assert.equal(c.port, 8080);
  assert.equal(c.publicUrl, 'https://a.test');
});

test('HOST is trimmed like every other setting; blank means the default', () => {
  assert.equal(loadConfig({ HOST: ' 0.0.0.0 ' }).host, '0.0.0.0');
  assert.equal(loadConfig({ HOST: '  ' }).host, loadConfig({}).host);
});

test('TRUST_PROXY 0, false or empty means off: no Secure cookie forced', () => {
  for (const value of ['0', 'false', '', undefined]) {
    const c = loadConfig(value === undefined ? {} : { TRUST_PROXY: value });
    assert.equal(c.trustProxy, false, `TRUST_PROXY=${value}`);
    assert.equal(c.session.cookieSecure, false, `TRUST_PROXY=${value}`);
  }
});

const ADMIN_PW = ENV_ADMIN.password;
const PROD = { NODE_ENV: 'production', SESSION_SECRET: 's', PUBLIC_URL: 'https://a.test' };
const problemMessage = (env) => {
  try {
    assertConfig(loadConfig(env));
    return '';
  } catch (error) {
    return error.message;
  }
};

test('admin env: email lower-cased and trimmed, name defaults to Admin', () => {
  const c = loadConfig({ ADMIN_EMAIL: '  Owner@Example.COM ', ADMIN_PASSWORD: ADMIN_PW });
  assert.deepEqual(c.admin, { email: 'owner@example.com', password: ADMIN_PW, name: 'Admin' });
  assert.equal(
    loadConfig({ ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: ADMIN_PW, ADMIN_NAME: ' Chris ' }).admin.name,
    'Chris',
  );
  assert.equal(loadConfig({ ADMIN_NAME: '' }).admin.name, 'Admin');
});

test('admin env: unset or empty email and password are null', () => {
  assert.deepEqual(loadConfig({}).admin, { email: null, password: null, name: 'Admin' });
  assert.deepEqual(loadConfig({ ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }).admin, {
    email: null,
    password: null,
    name: 'Admin',
  });
  assert.equal(loadConfig({ ADMIN_EMAIL: '   ' }).admin.email, null);
});

test('admin env is optional outside production', () => {
  assert.equal(problemMessage({}), '');
  assert.equal(problemMessage({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: ADMIN_PW }), '');
});

test('admin env: only one of ADMIN_EMAIL and ADMIN_PASSWORD set is an error naming both', () => {
  for (const env of [{ ADMIN_EMAIL: 'owner@example.com' }, { ADMIN_PASSWORD: ADMIN_PW }]) {
    const message = problemMessage(env);
    assert.match(message, /ADMIN_EMAIL/);
    assert.match(message, /ADMIN_PASSWORD/);
    assert.doesNotMatch(message, new RegExp(ADMIN_PW));
  }
});

test('admin env: an invalid ADMIN_EMAIL is an error', () => {
  for (const email of ['not-an-email', 'a@b', 'a b@c.de']) {
    assert.match(problemMessage({ ADMIN_EMAIL: email, ADMIN_PASSWORD: ADMIN_PW }), /ADMIN_EMAIL/, email);
  }
});

test('admin env: ADMIN_PASSWORD shorter than 10 characters is an error without the value', () => {
  const message = problemMessage({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'short9chr' });
  assert.match(message, /ADMIN_PASSWORD/);
  assert.match(message, /10 characters/);
  assert.doesNotMatch(message, /short9chr/);
  assert.equal(problemMessage({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: '0123456789' }), '');
});

test('production requires ADMIN_EMAIL and ADMIN_PASSWORD', () => {
  assert.match(problemMessage(PROD), /ADMIN_EMAIL and ADMIN_PASSWORD must be set in production\./);
  assert.equal(problemMessage({ ...PROD, ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: ADMIN_PW }), '');
});

test('production requires PUBLIC_URL; outside production it stays optional', () => {
  const admin = { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: ADMIN_PW };
  const withoutUrl = { NODE_ENV: 'production', SESSION_SECRET: 's', ...admin };
  assert.match(problemMessage(withoutUrl), /PUBLIC_URL must be set in production/);
  assert.match(problemMessage({ ...withoutUrl, PUBLIC_URL: '' }), /PUBLIC_URL/);
  assert.equal(problemMessage({ ...PROD, ...admin }), '');
  assert.equal(problemMessage(admin), '');
});

test('admin env: ADMIN_NAME is held to the display-name limit, like every other name', () => {
  const admin = { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: ADMIN_PW };
  assert.equal(problemMessage({ ...admin, ADMIN_NAME: 'x'.repeat(MAX_DISPLAY_NAME) }), '');
  assert.match(
    problemMessage({ ...admin, ADMIN_NAME: 'x'.repeat(MAX_DISPLAY_NAME + 1) }),
    new RegExp(`ADMIN_NAME must be at most ${MAX_DISPLAY_NAME} characters\\.`),
  );
});

test('PUBLIC_URL, when set, must be an absolute http or https address', () => {
  for (const bad of ['photos.example.com', 'ftp://photos.example.com', '/gallery']) {
    assert.match(problemMessage({ PUBLIC_URL: bad }), /PUBLIC_URL must be an absolute http or https address/, bad);
  }
  for (const good of ['https://photos.example.com', 'http://127.0.0.1:3000/gallery']) {
    assert.equal(problemMessage({ PUBLIC_URL: good }), '', good);
  }
});

test('admin env: a whitespace-only ADMIN_PASSWORD is an error', () => {
  const message = problemMessage({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: ' '.repeat(12) });
  assert.match(message, /ADMIN_PASSWORD/);
});

test('PORT must be 1 to 65535; anything else falls back', () => {
  assert.equal(loadConfig({ PORT: '65535' }).port, 65535);
  assert.equal(loadConfig({ PORT: '1' }).port, 1);
  for (const junk of ['65536', '70000', '99999999999999999999']) {
    assert.equal(loadConfig({ PORT: junk }).port, 3000, junk);
  }
});

test('TRASH_RETENTION_DAYS defaults to 30 and accepts only an integer from 1 to 3650', () => {
  assert.equal(loadConfig({}).trash.retentionDays, 30);
  assert.equal(loadConfig({ TRASH_RETENTION_DAYS: '7' }).trash.retentionDays, 7);
  assert.equal(loadConfig({ TRASH_RETENTION_DAYS: ' 90 ' }).trash.retentionDays, 90);
  assert.equal(loadConfig({ TRASH_RETENTION_DAYS: '1' }).trash.retentionDays, 1);
  assert.equal(loadConfig({ TRASH_RETENTION_DAYS: '3650' }).trash.retentionDays, 3650);
  for (const junk of ['', '0', '-3', '1.5', '7days', 'abc', '1e3', '3651', '99999999999999999999']) {
    assert.equal(loadConfig({ TRASH_RETENTION_DAYS: junk }).trash.retentionDays, 30, junk);
  }
  assert.ok(Object.isFrozen(loadConfig({}).trash));
});

test('numeric settings accept only plain integers: "3000abc" or "1.5" fall back instead of being cut', () => {
  for (const junk of ['3000abc', '1.5', '-1', '0', '1e3']) {
    assert.equal(loadConfig({ PORT: junk }).port, 3000, junk);
  }
  assert.equal(loadConfig({ PORT: ' 8080 ' }).port, 8080);
});

test('RATE_LIMIT_WINDOW_MS has an upper bound; larger values fall back', () => {
  assert.equal(loadConfig({ RATE_LIMIT_WINDOW_MS: '86400000' }).rateLimit.windowMs, 86_400_000);
  for (const junk of ['86400001', '99999999999999999999']) {
    assert.equal(loadConfig({ RATE_LIMIT_WINDOW_MS: junk }).rateLimit.windowMs, 900_000, junk);
  }
});

test('SESSION_DAYS accepts 1 to 3650 and falls back to 30 otherwise', () => {
  assert.equal(loadConfig({ SESSION_DAYS: '3650' }).session.days, 3650);
  for (const junk of ['3651', '99999999999999999999', '0', '7days']) {
    assert.equal(loadConfig({ SESSION_DAYS: junk }).session.days, 30, junk);
  }
});

test('SETTINGS_ENC_KEY is parsed once into a 32-byte Buffer (or null) on config.secretsKey', () => {
  const hex = 'ab'.repeat(32);
  const config = loadConfig({ SETTINGS_ENC_KEY: hex });
  assert.ok(Buffer.isBuffer(config.secretsKey));
  assert.equal(config.secretsKey.toString('hex'), hex);
  assert.doesNotThrow(() => assertConfig(config));
  assert.equal(loadConfig({}).secretsKey, null);
  assert.doesNotThrow(() => assertConfig(loadConfig({ SETTINGS_ENC_KEY: '   ' })), 'a blank key counts as unset');
  const bad = loadConfig({ SETTINGS_ENC_KEY: 'short' });
  assert.equal(bad.secretsKey, null);
  assert.throws(() => assertConfig(bad), /SETTINGS_ENC_KEY must be 32 bytes/);
  assert.equal(bad.secretsKeySet, true, 'a set but malformed key is recorded as set');
  assert.equal(config.secretsKeySet, true);
  assert.equal(loadConfig({}).secretsKeySet, false);
  assert.equal(loadConfig({ SETTINGS_ENC_KEY: '   ' }).secretsKeySet, false);
  for (const loaded of [config, bad]) {
    assert.deepEqual(
      Object.keys(loaded).filter((key) => /invalid/i.test(key)),
      [],
      'no validation flag in the runtime config',
    );
  }
  assert.ok(Object.isFrozen(config), 'config is still frozen with a Buffer inside');
});

test('a malformed SETTINGS_ENC_KEY is still refused after the config is copied (spread or structuredClone)', () => {
  const bad = loadConfig({ SETTINGS_ENC_KEY: 'short' });
  for (const copy of [{ ...bad }, structuredClone(bad)]) {
    assert.throws(() => assertConfig(copy), /SETTINGS_ENC_KEY must be 32 bytes/);
  }
  const good = loadConfig({ SETTINGS_ENC_KEY: 'ab'.repeat(32) });
  assert.doesNotThrow(() => assertConfig({ ...good }));
});

test('DATABASE_PATH is resolved from the project folder, not the working directory', () => {
  assert.equal(
    loadConfig({ DATABASE_PATH: './data/x.sqlite' }).databasePath,
    path.join(PROJECT_ROOT, 'data', 'x.sqlite'),
  );
  assert.equal(loadConfig({ DATABASE_PATH: '/srv/db.sqlite' }).databasePath, '/srv/db.sqlite');
  assert.equal(loadConfig({ DATABASE_PATH: ':memory:' }).databasePath, ':memory:');
  assert.equal(PROJECT_ROOT, path.resolve(fileURLToPath(new URL('../../', import.meta.url))));
});

test('a file: URI DATABASE_PATH is refused: the SQLite driver would take it as a file name', () => {
  for (const uri of ['file:x.db?mode=memory', 'file:/srv/db.sqlite?mode=ro', 'file::memory:?cache=shared']) {
    assert.equal(loadConfig({ DATABASE_PATH: uri }).databasePath, uri, 'kept as written');
    assert.match(
      problemMessage({ DATABASE_PATH: uri }),
      /DATABASE_PATH must be a file path or :memory:; SQLite file: URIs are not supported\./,
      uri,
    );
  }
});

test('TRUST_PROXY words ignore case and spaces; yes/on and no/off are accepted', () => {
  for (const value of ['TRUE', ' true ', 'Yes', 'on']) {
    assert.equal(loadConfig({ TRUST_PROXY: value }).trustProxy, true, `TRUST_PROXY=${value}`);
  }
  for (const value of ['FALSE', ' False ', 'no', 'OFF', ' 0 ', '   ']) {
    const c = loadConfig({ TRUST_PROXY: value });
    assert.equal(c.trustProxy, false, `TRUST_PROXY=${value}`);
    assert.equal(c.session.cookieSecure, false, `TRUST_PROXY=${value}`);
  }
  assert.equal(loadConfig({ TRUST_PROXY: ' 2 ' }).trustProxy, 2);
  assert.equal(loadConfig({ TRUST_PROXY: ' loopback, 10.0.0.0/8 ' }).trustProxy, 'loopback, 10.0.0.0/8');
});

test('every number comes from SETTING_DEFS or TUNABLES: an empty environment gives each default', () => {
  const c = loadConfig({});
  assert.deepEqual(
    {
      port: c.port,
      sessionDays: c.session.days,
      publicFormMax: c.rateLimit.publicFormMax,
      zipMax: c.rateLimit.zipMax,
      windowMs: c.rateLimit.windowMs,
      trashRetentionDays: c.trash.retentionDays,
      activityRetentionDays: c.activity.retentionDays,
      logRetentionDays: c.log.retentionDays,
    },
    Object.fromEntries(Object.entries(SETTING_DEFS).map(([name, def]) => [name, def.defaultValue])),
  );
  assert.deepEqual(
    { itemsPerPage: c.itemsPerPage, ...c.limits },
    Object.fromEntries(Object.entries(TUNABLES).map(([name, def]) => [name, def.defaultValue])),
  );
});

test('RATE_LIMIT_PUBLIC_FORM_MAX sets the public-form limit; the old RATE_LIMIT_LOGIN_MAX name is ignored', () => {
  assert.equal(loadConfig({ RATE_LIMIT_PUBLIC_FORM_MAX: '7' }).rateLimit.publicFormMax, 7);
  assert.equal(loadConfig({ RATE_LIMIT_LOGIN_MAX: '4' }).rateLimit.publicFormMax, 10);
  assert.equal(loadConfig({}).rateLimit.publicFormMax, 10);
});

test('RATE_LIMIT_SHARE_MAX sets the share page limit; it defaults to the public-form limit', () => {
  assert.equal(loadConfig({ RATE_LIMIT_SHARE_MAX: '50' }).rateLimit.shareMax, 50);
  assert.equal(loadConfig({ RATE_LIMIT_SHARE_MAX: '50' }).rateLimit.publicFormMax, 10);
  assert.equal(loadConfig({ RATE_LIMIT_PUBLIC_FORM_MAX: '7' }).rateLimit.shareMax, 7);
  assert.equal(loadConfig({ RATE_LIMIT_PUBLIC_FORM_MAX: '7', RATE_LIMIT_SHARE_MAX: 'x' }).rateLimit.shareMax, 7);
  assert.equal(loadConfig({}).rateLimit.shareMax, 10);
});

test('SHARE_GRID_TEXT: on by default; true/false words ignore case and spaces; anything else is refused', () => {
  assert.equal(loadConfig({}).shareGridText, true);
  assert.equal(loadConfig({ SHARE_GRID_TEXT: '' }).shareGridText, true);
  for (const word of ['false', ' OFF ', 'no', '0'])
    assert.equal(loadConfig({ SHARE_GRID_TEXT: word }).shareGridText, false, word);
  for (const word of ['true', 'On', 'yes', '1'])
    assert.equal(loadConfig({ SHARE_GRID_TEXT: word }).shareGridText, true, word);
  assert.throws(() => assertConfig(loadConfig({ SHARE_GRID_TEXT: 'hide' })), /SHARE_GRID_TEXT must be true or false/);
  assert.doesNotThrow(() => assertConfig(loadConfig({ SHARE_GRID_TEXT: 'false' })));
});

test('readEnvFile parses a .env file without touching process.env, and a missing file is empty', (t) => {
  const dir = tempDir(t, 'galleryshare-env-');
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '# comment\nGALLERYSHARE_TEST_ONLY_VAR=from-file\nPORT="4100"\n');
  assert.deepEqual(readEnvFile(file), { GALLERYSHARE_TEST_ONLY_VAR: 'from-file', PORT: '4100' });
  assert.equal(process.env.GALLERYSHARE_TEST_ONLY_VAR, undefined);
  assert.deepEqual(readEnvFile(path.join(dir, 'missing.env')), {});
});

const KNOWN_ENV_FILE = 'PORT=4111\nGALLERYSHARE_TEST_ONLY_VAR=from-file\n';

test('loadConfig() reads .env and leaves process.env unchanged; real variables win; the skip flag ignores the file; a given map reads it only with envFile', () => {
  const script = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const envFile = path.join(process.cwd(), '.env');",
    'const read = fs.readFileSync;',
    'fs.readFileSync = (file, ...rest) =>',
    `  path.resolve(String(file)) === envFile ? ${JSON.stringify(KNOWN_ENV_FILE)} : read(file, ...rest);`,
    "const { loadConfig } = await import('./config/index.js');",
    'const before = JSON.stringify(process.env);',
    'const config = loadConfig();',
    'const skipped = loadConfig({ ...process.env });',
    'const explicit = loadConfig({}, { envFile: true });',
    'console.log(JSON.stringify({ unchanged: JSON.stringify(process.env) === before, port: config.port, skippedPort: skipped.port, explicitPort: explicit.port }));',
  ].join('\n');
  const run = (extra) => {
    const env = { ...process.env, ...extra };
    for (const name of ['PORT', 'GALLERYSHARE_SKIP_ENV_FILE']) if (!(name in extra)) delete env[name];
    return JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: PROJECT_ROOT,
        env,
        encoding: 'utf8',
      }),
    );
  };
  const fromFile = run({});
  assert.equal(fromFile.port, 4111, 'the .env file is read when the variable is not set');
  assert.equal(fromFile.unchanged, true, 'process.env is not modified by the .env file');
  assert.equal(fromFile.skippedPort, 3000, 'a map passed in is used alone');
  assert.equal(fromFile.explicitPort, 4111, 'envFile: true reads the file under a map passed in');
  const withFile = run({ PORT: '4321' });
  assert.equal(withFile.unchanged, true, 'process.env is not modified by the .env file');
  assert.equal(withFile.port, 4321, 'a real environment variable wins over the file');
  const skipped = run({ PORT: '4322', GALLERYSHARE_SKIP_ENV_FILE: '1' });
  assert.deepEqual(skipped, { unchanged: true, port: 4322, skippedPort: 4322, explicitPort: 4111 });
});

test('ITEMS_PER_PAGE defaults to 25 and accepts only a whole number from 5 to 100', () => {
  assert.equal(loadConfig({}).itemsPerPage, 25);
  assert.equal(loadConfig({ ITEMS_PER_PAGE: '5' }).itemsPerPage, 5);
  assert.equal(loadConfig({ ITEMS_PER_PAGE: ' 100 ' }).itemsPerPage, 100);
  assert.equal(loadConfig({ ITEMS_PER_PAGE: '40' }).itemsPerPage, 40);
  for (const junk of ['', '4', '0', '101', '25.5', '30rows', 'abc', '-10']) {
    assert.equal(loadConfig({ ITEMS_PER_PAGE: junk }).itemsPerPage, 25, junk);
  }
});

test('limits come from .env with defaults', () => {
  const c = loadConfig({ MAX_IMAGE_MB: '30' });
  assert.deepEqual(c.limits, {
    maxImageMb: 30,
    maxZipUploadMb: 500,
    maxImagesPerGallery: 500,
    userQuotaMb: 0,
    maxUploadBatchMb: 1000,
  });
  assert.equal(loadConfig({ USER_QUOTA_MB: '2048' }).limits.userQuotaMb, 2048);
  assert.equal(loadConfig({ MAX_IMAGE_MB: '0' }).limits.maxImageMb, 25, 'out of range falls back');
});

test('MEDIA_DIR and TMP_UPLOAD_DIR default under data/ and resolve from the project folder', () => {
  const c = loadConfig({});
  assert.equal(c.mediaDir, path.join(PROJECT_ROOT, 'data', 'media'));
  assert.equal(c.tmpDir, path.join(PROJECT_ROOT, 'data', 'tmp'));
  const d = loadConfig({ MEDIA_DIR: './m', TMP_UPLOAD_DIR: '/srv/tmp' });
  assert.equal(d.mediaDir, path.join(PROJECT_ROOT, 'm'));
  assert.equal(d.tmpDir, '/srv/tmp');
});

test('log settings default to ./data/logs, 30 days and info, and resolve from the project folder', () => {
  const c = loadConfig({});
  assert.deepEqual(c.log, { dir: path.join(PROJECT_ROOT, 'data', 'logs'), retentionDays: 30, level: 'info' });
  const d = loadConfig({ LOG_DIR: './l', LOG_RETENTION_DAYS: '7', LOG_LEVEL: ' Debug ' });
  assert.deepEqual(d.log, { dir: path.join(PROJECT_ROOT, 'l'), retentionDays: 7, level: 'debug' });
  assert.equal(loadConfig({ LOG_DIR: '/srv/logs' }).log.dir, '/srv/logs');
  assert.equal(loadConfig({ LOG_RETENTION_DAYS: '0' }).log.retentionDays, 30);
  assert.equal(loadConfig({ LOG_RETENTION_DAYS: '3651' }).log.retentionDays, 30);
});

test('assertConfig refuses a LOG_LEVEL other than error, warn, info or debug', () => {
  for (const level of ['error', 'warn', 'info', 'debug'])
    assert.doesNotThrow(() => assertConfig(loadConfig({ LOG_LEVEL: level })));
  assert.throws(
    () => assertConfig(loadConfig({ LOG_LEVEL: 'verbose' })),
    /LOG_LEVEL must be error, warn, info or debug\./,
  );
});

test('assertConfig refuses a TMP_UPLOAD_DIR that overlaps MEDIA_DIR or holds the database', (t) => {
  const root = tempDir(t, 'gs-cfg-');
  const media = path.join(root, 'data', 'media');
  const db = path.join(root, 'data', 'app.sqlite');
  const check = (tmp, extra = {}) =>
    assertConfig(loadConfig({ MEDIA_DIR: media, DATABASE_PATH: db, TMP_UPLOAD_DIR: tmp, ...extra }));
  const mediaProblem = /TMP_UPLOAD_DIR must be a separate folder/;
  assert.throws(() => check(media), mediaProblem, 'equal to MEDIA_DIR');
  assert.throws(() => check(path.join(media, 'tmp')), mediaProblem, 'inside MEDIA_DIR');
  assert.throws(() => check(path.join(root, 'data')), mediaProblem, 'contains MEDIA_DIR');
  assert.throws(() => check(root), /TMP_UPLOAD_DIR must not contain the database file/, 'contains the database');
  assert.throws(
    () => check(path.join(root, 'elsewhere'), { DATABASE_PATH: path.join(root, 'elsewhere', 'x', 'db.sqlite') }),
    /must not contain the database file/,
  );
  assert.doesNotThrow(() => check(path.join(root, 'data', 'tmp')));
  assert.doesNotThrow(() => check(path.join(root, 'data', 'media-tmp')), 'a sibling with a shared prefix is fine');
  assert.doesNotThrow(() => check(path.join(root, 'tmp'), { DATABASE_PATH: ':memory:' }));
  assert.doesNotThrow(() => assertConfig(loadConfig({})), 'the defaults are separate folders');
});

test('assertConfig resolves symlinks before comparing TMP_UPLOAD_DIR with MEDIA_DIR', (t) => {
  const root = tempDir(t, 'gs-cfg-');
  const media = path.join(root, 'media');
  fs.mkdirSync(media);
  const link = path.join(root, 'link-to-media');
  fs.symlinkSync(media, link);
  assert.throws(
    () => assertConfig(loadConfig({ MEDIA_DIR: media, TMP_UPLOAD_DIR: link, DATABASE_PATH: ':memory:' })),
    /TMP_UPLOAD_DIR must be a separate folder/,
  );
  assert.throws(
    () =>
      assertConfig(
        loadConfig({ MEDIA_DIR: media, TMP_UPLOAD_DIR: path.join(link, 'not-yet'), DATABASE_PATH: ':memory:' }),
      ),
    /TMP_UPLOAD_DIR must be a separate folder/,
    'a missing folder under a symlink still resolves',
  );
});

test('SHARE_THEME: none by default; a theme key ignores case and spaces; anything else is refused', () => {
  assert.equal(loadConfig({}).shareTheme, 'none');
  assert.equal(loadConfig({ SHARE_THEME: '' }).shareTheme, 'none');
  assert.equal(loadConfig({ SHARE_THEME: ' Dark-Wall ' }).shareTheme, 'dark-wall');
  for (const key of ['frame', 'app-window', 'polaroid', 'glass', 'paper-stack']) {
    assert.equal(loadConfig({ SHARE_THEME: key }).shareTheme, key, key);
  }
  assert.equal(loadConfig({ SHARE_THEME: 'neon' }).shareTheme, null);
  assert.throws(
    () => assertConfig(loadConfig({ SHARE_THEME: 'neon' })),
    /SHARE_THEME: Choose a share theme: none, frame/,
  );
  assert.doesNotThrow(() => assertConfig(loadConfig({ SHARE_THEME: 'glass' })));
});

test('SHARE_IMAGE_VIEW: lightbox by default; a view key ignores case and spaces; anything else is refused', () => {
  assert.equal(loadConfig({}).shareImageView, 'lightbox');
  assert.equal(loadConfig({ SHARE_IMAGE_VIEW: ' New-Tab ' }).shareImageView, 'new-tab');
  assert.equal(loadConfig({ SHARE_IMAGE_VIEW: 'page' }).shareImageView, 'page');
  assert.equal(loadConfig({ SHARE_IMAGE_VIEW: 'popup' }).shareImageView, null);
  assert.throws(
    () => assertConfig(loadConfig({ SHARE_IMAGE_VIEW: 'popup' })),
    /SHARE_IMAGE_VIEW: Choose an image view: lightbox, new-tab, page/,
  );
});

test('COOKIE_SECURE takes the same on and off words as the other true/false settings', () => {
  for (const value of ['true', 'TRUE', ' yes ', 'on', '1']) {
    assert.equal(loadConfig({ COOKIE_SECURE: value }).session.cookieSecure, true, `COOKIE_SECURE=${value}`);
  }
  for (const value of [undefined, '', 'false', 'no', 'off', '0', 'maybe']) {
    assert.equal(loadConfig({ COOKIE_SECURE: value }).session.cookieSecure, false, `COOKIE_SECURE=${value}`);
  }
});
