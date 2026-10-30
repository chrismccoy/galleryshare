import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../db/database.js';
import { migrate, MIGRATIONS, SCHEMA_V1, SCHEMA_V2 } from '../../db/migrations.js';
import { nowIso, toIso } from '../../lib/time.js';
import { dbAtVersion, freshDb } from '../helpers/db.js';
import { insertBareUser } from '../helpers/accounts.js';

const N = MIGRATIONS.length;

test('the migrations are version 1 (the schema), 2 (the sessions token_hash rename), 3 (image hashes), 4 (gallery grid text), 5 (activity), 6 (gallery share theme) and 7 (gallery image view), in order', () => {
  assert.deepEqual(
    MIGRATIONS.map((m) => m.version),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(typeof SCHEMA_V1, 'string');
  assert.match(SCHEMA_V2, /RENAME COLUMN token TO token_hash/);
});

test('version 5 creates the activity table with its columns and no foreign keys', () => {
  const db = dbAtVersion(4);
  assert.deepEqual(migrate(db), { from: 4, to: N });
  const cols = db.prepare('PRAGMA table_info(activity)').all();
  assert.deepEqual(
    cols.map((c) => c.name),
    [
      'id',
      'at',
      'area',
      'kind',
      'actor_type',
      'actor_id',
      'actor_name',
      'subject_user_id',
      'subject_name',
      'gallery_id',
      'gallery_title',
      'details',
      'ip',
      'user_agent',
    ],
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(activity)').all(), []);
  const indexed = db
    .prepare('PRAGMA index_list(activity)')
    .all()
    .map((i) =>
      db
        .prepare(`PRAGMA index_info(${i.name})`)
        .all()
        .map((c) => c.name)
        .join(','),
    )
    .sort();
  assert.deepEqual(indexed, ['actor_id,id', 'area,id', 'at', 'gallery_id,id', 'subject_user_id,id']);
  assert.throws(
    () => db.prepare("INSERT INTO activity (at, area, kind, actor_type) VALUES ('x', 'a', 'k', 'robot')").run(),
    /CHECK constraint/,
  );
});

test('version 4 adds galleries.grid_text: null for existing rows, and only null, 0 or 1', () => {
  const db = dbAtVersion(3);
  const uid = insertBareUser(db, { email: 'a@example.com' });
  const gid = db
    .prepare("INSERT INTO galleries (user_id, created_at, updated_at) VALUES (?, 'x', 'x')")
    .run(uid).lastInsertRowid;
  assert.deepEqual(migrate(db), { from: 3, to: N });
  assert.equal(db.prepare('SELECT grid_text FROM galleries WHERE id = ?').get(gid).grid_text, null);
  db.prepare('UPDATE galleries SET grid_text = 0 WHERE id = ?').run(gid);
  db.prepare('UPDATE galleries SET grid_text = 1 WHERE id = ?').run(gid);
  assert.throws(() => db.prepare('UPDATE galleries SET grid_text = 2 WHERE id = ?').run(gid), /CHECK constraint/);
});

test('version 6 adds a nullable galleries.share_theme column and keeps existing rows', () => {
  const db = dbAtVersion(5);
  const uid = insertBareUser(db, { email: 'theme@example.com' });
  const gid = db
    .prepare("INSERT INTO galleries (user_id, title, created_at, updated_at) VALUES (?, 'Kept', 'x', 'x')")
    .run(uid).lastInsertRowid;
  assert.deepEqual(migrate(db), { from: 5, to: N });
  const row = db.prepare('SELECT title, share_theme FROM galleries WHERE id = ?').get(gid);
  assert.deepEqual({ ...row }, { title: 'Kept', share_theme: null });
  db.prepare("UPDATE galleries SET share_theme = 'glass' WHERE id = ?").run(gid);
  assert.equal(db.prepare('SELECT share_theme FROM galleries WHERE id = ?').get(gid).share_theme, 'glass');
});

test('version 7 adds a nullable galleries.image_view column and keeps existing rows', () => {
  const db = dbAtVersion(6);
  const uid = insertBareUser(db, { email: 'view@example.com' });
  const gid = db
    .prepare(
      "INSERT INTO galleries (user_id, title, share_theme, created_at, updated_at) VALUES (?, 'Kept', 'glass', 'x', 'x')",
    )
    .run(uid).lastInsertRowid;
  assert.deepEqual(migrate(db), { from: 6, to: N });
  const row = db.prepare('SELECT title, share_theme, image_view FROM galleries WHERE id = ?').get(gid);
  assert.deepEqual({ ...row }, { title: 'Kept', share_theme: 'glass', image_view: null });
});

test('version 3 adds a nullable gallery_images.phash column and keeps existing rows', () => {
  const db = dbAtVersion(2);
  const uid = insertBareUser(db, { email: 'a@example.com' });
  const gid = db
    .prepare("INSERT INTO galleries (user_id, created_at, updated_at) VALUES (?, 'x', 'x')")
    .run(uid).lastInsertRowid;
  db.prepare(
    `INSERT INTO gallery_images (gallery_id, position, public_name, original_name, mime, ext, width, height,
                                 bytes_orig, bytes_web, bytes_thumb, created_at)
     VALUES (?, 1, 'pubname001', 'a.jpg', 'image/jpeg', 'jpg', 10, 10, 1, 1, 1, 'x')`,
  ).run(gid);
  assert.deepEqual(migrate(db), { from: 2, to: N });
  const col = db
    .prepare('PRAGMA table_info(gallery_images)')
    .all()
    .find((c) => c.name === 'phash');
  assert.ok(col, 'phash column exists');
  assert.equal(col.notnull, 0);
  assert.equal(db.prepare('SELECT phash FROM gallery_images').get().phash, null);
});

test('version 2 renames sessions.token to token_hash on a version 1 database and keeps its rows', () => {
  const db = dbAtVersion(1);
  const uid = insertBareUser(db, { email: 'a@example.com' });
  db.prepare("INSERT INTO sessions (token, user_id, csrf_token, expires_at) VALUES ('hash', ?, 'c', 'x')").run(uid);
  assert.deepEqual(migrate(db), { from: 1, to: N });
  const cols = db
    .prepare('PRAGMA table_info(sessions)')
    .all()
    .map((c) => [c.name, c.pk]);
  assert.deepEqual(cols.slice(0, 2), [
    ['token_hash', 1],
    ['user_id', 0],
  ]);
  assert.equal(db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get('hash').user_id, uid);
});

test('the SQL column default writes timestamps in the format lib/time.js writes (they are compared as text)', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO users (email, display_name, password_hash, role) VALUES ('a@example.com', 'a', 'x', 'user')",
  ).run();
  const stored = db.prepare('SELECT created_at FROM users').get().created_at;
  const js = nowIso();
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  assert.match(stored, pattern);
  assert.match(js, pattern);
  assert.equal(toIso(new Date(stored)), stored, 'the SQL value round-trips through the JS format unchanged');
  assert.ok(Math.abs(Date.parse(js) - Date.parse(stored)) < 60_000, 'both are UTC');
});

test('migrate on empty db applies all and records versions', () => {
  const db = openDatabase(':memory:');
  assert.deepEqual(migrate(db), { from: 0, to: N });
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(
    versions.map((r) => r.version),
    MIGRATIONS.map((m) => m.version),
  );
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, [
    'activity',
    'galleries',
    'gallery_images',
    'gallery_share_views',
    'gallery_shares',
    'ingest_jobs',
    'invites',
    'rate_limit_windows',
    'reset_tokens',
    'schema_migrations',
    'sessions',
    'settings',
    'users',
  ]);
});

test('the core schema keeps invites.token_enc', () => {
  const db = freshDb();
  const cols = db
    .prepare('PRAGMA table_info(invites)')
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes('token_enc'));
});

test('dbAtVersion records versions in the schema_migrations table migrate creates', () => {
  const db = dbAtVersion(1);
  const ddl = (d) => d.prepare("SELECT sql FROM sqlite_master WHERE name = 'schema_migrations'").get().sql;
  assert.equal(ddl(db), ddl(freshDb()));
  assert.match(db.prepare('SELECT applied_at FROM schema_migrations WHERE version = 1').get().applied_at, /^\d{4}-/);
});

test('migrate twice is a no-op', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  assert.deepEqual(migrate(db), { from: N, to: N });
});

test('deleting a user cascades sessions and reset_tokens', () => {
  const db = freshDb();
  const uid = insertBareUser(db, { email: 'a@example.com' });
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES ('t', ?, 'c', 'x')").run(uid);
  db.prepare("INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, 'h', 'x')").run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  for (const t of ['sessions', 'reset_tokens']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});
