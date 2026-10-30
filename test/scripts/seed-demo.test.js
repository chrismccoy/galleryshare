import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from '../../db/database.js';
import { migrate } from '../../db/migrations.js';
import { DEMO_DOMAIN } from '../../scripts/seed-demo/data.js';
import { tempDir } from '../helpers/temp.js';
import { rowCount } from '../helpers/db.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/seed-demo.js', import.meta.url));

function seedOptions(dir) {
  return {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot ?? '',
      GALLERYSHARE_SKIP_ENV_FILE: '1',
      DATABASE_PATH: path.join(dir, 'demo.sqlite'),
      MEDIA_DIR: path.join(dir, 'media'),
      TMP_UPLOAD_DIR: path.join(dir, 'tmp'),
      ADMIN_EMAIL: 'seed-owner@example.com',
      ADMIN_PASSWORD: 'seed owner long password',
    },
    encoding: 'utf8',
  };
}

const runSeed = (dir) => execFileSync(process.execPath, [SCRIPT], seedOptions(dir));

function mediaFiles(dir) {
  const root = path.join(dir, 'media');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true }).filter((name) => fs.statSync(path.join(root, name)).isFile());
}

function assertDemoActivity(db) {
  const rows = db.prepare('SELECT * FROM activity ORDER BY id').all();
  assert.ok(rows.length >= 50, `a full history: ${rows.length} rows`);
  assert.deepEqual(
    new Set(rows.map((row) => row.area)),
    new Set(['accounts', 'galleries', 'sharing', 'settings', 'security', 'system']),
  );
  const times = rows.map((row) => Date.parse(row.at));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
    'newest id is newest time',
  );
  assert.ok(times.at(-1) <= Date.now(), 'nothing in the future');
  assert.equal(rows.filter((row) => row.kind === 'demoSeeded').length, 1);
  assert.ok(Date.now() - times[0] < 90 * 24 * 60 * 60 * 1000, 'all inside the default 90-day retention');
  assert.ok(Date.now() - times[0] > 30 * 24 * 60 * 60 * 1000, 'back-dated over weeks, not stamped today');
  const maya = db.prepare('SELECT id FROM users WHERE email = ?').get(`maya@${DEMO_DOMAIN}`).id;
  const mine = rows.filter((row) => row.actor_id === maya || row.subject_user_id === maya);
  assert.ok(
    mine.some((row) => row.kind === 'galleryVisited' && row.actor_type === 'visitor'),
    'visits of her gallery',
  );
  assert.ok(
    mine.some((row) => row.kind === 'galleryDetailsChanged' && row.actor_id !== maya),
    'an admin edit of her gallery',
  );
  const last = rows.at(-1);
  assert.deepEqual(
    [last.kind, last.area, last.actor_type, last.details],
    ['demoSeeded', 'system', 'system', '3 users, 6 galleries, 55 images, 70 activity events'],
    'the newest row says the demo data was written',
  );
  assert.ok(Date.now() - Date.parse(last.at) < 60 * 1000, 'stamped at the run');
  assert.equal(
    rows.filter((row) => row.kind === 'linkShared').length,
    1,
    'the share is recorded once, at its story time',
  );
}

test('the demo seed fills a fresh database and media folder once, after a backup, and refuses a second run', (t) => {
  const dir = tempDir(t, 'galleryshare-seed-');
  assert.match(runSeed(dir), /Demo data written/);
  const backups = () => fs.readdirSync(dir).filter((name) => name.startsWith('backup-before-demo-'));
  assert.equal(backups().length, 1);

  const db = openDatabase(path.join(dir, 'demo.sqlite'));
  try {
    assert.equal(rowCount(db, 'users', 'email LIKE ?', `%@${DEMO_DOMAIN}`), 3, 'demo users');
    assert.equal(rowCount(db, 'galleries'), 6, 'galleries');
    assert.equal(rowCount(db, 'galleries', 'deleted_at IS NOT NULL'), 1, 'one in Trash');
    assert.equal(rowCount(db, 'gallery_shares', 'revoked_at IS NULL'), 1, 'one shared');
    const sizes = db
      .prepare(
        'SELECT COUNT(i.id) AS n FROM galleries g LEFT JOIN gallery_images i ON i.gallery_id = g.id GROUP BY g.id',
      )
      .all()
      .map((row) => row.n);
    assert.ok(Math.min(...sizes) >= 1 && Math.max(...sizes) <= 24, `1 to 24 images each: ${sizes}`);
    const images = db.prepare('SELECT * FROM gallery_images').all();
    assert.deepEqual(new Set(images.map((image) => image.ext)), new Set(['jpg', 'png', 'webp']));
    for (const image of images) {
      assert.match(image.public_name, /^[0-9A-Za-z]{10}$/);
      assert.ok(image.bytes_orig > 0 && image.bytes_web > 0 && image.bytes_thumb > 0, 'sizes recorded');
    }
    assert.equal(mediaFiles(dir).length, images.length * 3, 'original, web and thumbnail on disk per image');
    assert.equal(rowCount(db, 'invites'), 1);
    assertDemoActivity(db);
  } finally {
    db.close();
  }

  assert.match(runSeed(dir), /already present; nothing written/);
  assert.equal(backups().length, 1, 'no backup for a refused run');
});

test('a demo seed that fails part-way leaves no demo data or media behind, and a rerun then succeeds', (t) => {
  const dir = tempDir(t, 'galleryshare-seed-');
  const file = path.join(dir, 'demo.sqlite');
  const prepared = openDatabase(file);
  migrate(prepared);
  prepared.exec("CREATE TRIGGER no_invites BEFORE INSERT ON invites BEGIN SELECT RAISE(ABORT, 'invites refused'); END");
  prepared.close();
  assert.throws(() => runSeed(dir), /invites refused/);

  const db = openDatabase(file);
  try {
    assert.equal(rowCount(db, 'users', 'email LIKE ?', `%@${DEMO_DOMAIN}`), 0);
    assert.equal(rowCount(db, 'galleries'), 0);
    assert.equal(rowCount(db, 'gallery_images'), 0);
    assert.equal(rowCount(db, 'gallery_shares'), 0);
    assert.equal(rowCount(db, 'activity'), 0, 'the failed run leaves no activity (the share it made was recorded)');
    db.exec('DROP TRIGGER no_invites');
  } finally {
    db.close();
  }
  assert.deepEqual(mediaFiles(dir), []);

  assert.match(runSeed(dir), /Demo data written/);
});

test('the demo seed refuses NODE_ENV=production with a clear message and writes nothing', (t) => {
  const dir = tempDir(t, 'galleryshare-seed-');
  const options = seedOptions(dir);
  const run = spawnSync(process.execPath, [SCRIPT], {
    ...options,
    env: {
      ...options.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'production-like-secret-0123456789abcdef',
      PUBLIC_URL: 'https://photos.example.com',
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Refusing to write demo data with NODE_ENV=production/);
  assert.match(run.stderr, /Nothing was written\./);
  assert.doesNotMatch(run.stderr, /\bat /, 'no stack trace');
  assert.deepEqual(fs.readdirSync(dir), [], 'no database, backup or media');
});

test('importing the seed script runs nothing and exports main', (t) => {
  const dir = tempDir(t, 'galleryshare-seed-');
  const probe = `const m = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log(typeof m.main);`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], seedOptions(dir));
  assert.equal(out.trim(), 'function');
  assert.equal(fs.existsSync(path.join(dir, 'demo.sqlite')), false, 'no database was opened');
});
