import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { SETTING_DEFS, loadConfig } from '../../config/index.js';
import { TUNABLES } from '../../domain/limits.js';

test('README names the app and points to SETUP.md', () => {
  const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('# GalleryShare'), 'README is missing the title');
  assert.ok(readme.includes('(SETUP.md)'), 'README does not point to SETUP.md');
  assert.doesNotMatch(readme, /sk-[A-Za-z0-9]{10,}/, 'README must not contain a key');
});

test('SETUP.md documents setup', () => {
  const setup = fs.readFileSync(new URL('../../SETUP.md', import.meta.url), 'utf8');
  for (const needle of ['npm install', 'cp .env.example .env', 'SESSION_SECRET', 'ADMIN_EMAIL']) {
    assert.ok(setup.includes(needle), `SETUP.md is missing: ${needle}`);
  }
  assert.doesNotMatch(setup, /sk-[A-Za-z0-9]{10,}/, 'SETUP.md must not contain a key');
});

test('the secret-generating hints use the crypto global, not require(), and that command works', () => {
  for (const file of ['../../SETUP.md', '../../.env.example']) {
    const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /require\(/, `${file} uses require()`);
    assert.match(text, /node -e "console\.log\(crypto\.randomBytes\(32\)\.toString\('hex'\)\)"/, file);
  }
  const out = execFileSync(process.execPath, ['-e', "console.log(crypto.randomBytes(32).toString('hex'))"], {
    encoding: 'utf8',
  });
  assert.match(out.trim(), /^[0-9a-f]{64}$/);
});

test('.env.example points the database at galleryshare.sqlite', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /DATABASE_PATH=\.\/data\/galleryshare\.sqlite/);
});

const TABLE_ROWS = [...Object.values(SETTING_DEFS), ...Object.values(TUNABLES)];

test('.env.example lists every setting config/index.js reads', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const read = new Set();
  const recorder = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key === 'string') read.add(key);
        return undefined;
      },
    },
  );
  loadConfig(recorder, { envFile: false });
  assert.ok(read.size > 20, `found ${read.size} settings`);
  for (const name of read) assert.match(example, new RegExp(`^${name}=`, 'm'), `.env.example is missing ${name}`);
  const listed = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  for (const name of listed) assert.ok(read.has(name), `.env.example lists ${name}, which the app does not read`);
});

test('.env.example sets each table setting to its default as written in the code, and pins no derived default', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const { env, defaultValue } of TABLE_ROWS) {
    const value = example.match(new RegExp(`^${env}=(.*)$`, 'm'))?.[1];
    assert.ok(
      value === '' || value === String(defaultValue),
      `${env}=${value} differs from its default ${defaultValue}`,
    );
  }
  assert.match(example, /^RATE_LIMIT_SHARE_MAX=$/m, 'the share limit follows RATE_LIMIT_PUBLIC_FORM_MAX unless set');
});
