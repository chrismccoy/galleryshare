import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../db/database.js';
import { isUniqueViolation, retryOnCollision } from '../../lib/sqlite-errors.js';

function errorOf(db, sql) {
  try {
    db.exec(sql);
  } catch (error) {
    return error;
  }
  throw new Error(`no error from: ${sql}`);
}

function constrainedDb() {
  const db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE parents (id INTEGER PRIMARY KEY);
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      size INTEGER CHECK (size > 0),
      parent_id INTEGER REFERENCES parents(id)
    );
    INSERT INTO items (name, code, size) VALUES ('a', 'c1', 1);
  `);
  return db;
}

test('isUniqueViolation matches the UNIQUE failure of the named column only', () => {
  const db = constrainedDb();
  const nameClash = errorOf(db, "INSERT INTO items (name, size) VALUES ('a', 1)");
  assert.equal(isUniqueViolation(nameClash, 'items.name'), true);
  assert.equal(isUniqueViolation(nameClash, 'items.code'), false);
  assert.equal(isUniqueViolation(nameClash, 'items.nam'), false, 'no prefix match');
  const codeClash = errorOf(db, "INSERT INTO items (name, code, size) VALUES ('b', 'c1', 1)");
  assert.equal(isUniqueViolation(codeClash, 'items.code'), true);
  assert.equal(isUniqueViolation(codeClash, 'items.name'), false);
});

test('isUniqueViolation is false for CHECK, NOT NULL and FOREIGN KEY failures and for non-database errors', () => {
  const db = constrainedDb();
  const failures = [
    errorOf(db, "INSERT INTO items (name, size) VALUES ('b', 0)"),
    errorOf(db, 'INSERT INTO items (name, size) VALUES (NULL, 1)'),
    errorOf(db, "INSERT INTO items (name, size, parent_id) VALUES ('b', 1, 99)"),
  ];
  for (const error of failures) {
    assert.match(error.code, /^SQLITE_CONSTRAINT/);
    assert.equal(isUniqueViolation(error, 'items.name'), false, error.code);
  }
  const lookalike = new Error('UNIQUE constraint failed: items.name');
  assert.equal(isUniqueViolation(lookalike, 'items.name'), false, 'the message alone is not enough');
  assert.equal(isUniqueViolation(null, 'items.name'), false);
  assert.equal(isUniqueViolation(undefined, 'items.name'), false);
});

test('retryOnCollision retries a UNIQUE clash on the column and returns the first success', () => {
  const db = constrainedDb();
  const names = ['a', 'a', 'fresh'];
  let calls = 0;
  const id = retryOnCollision(5, 'items.name', () => {
    calls += 1;
    return db.prepare('INSERT INTO items (name, size) VALUES (?, 1)').run(names.shift()).lastInsertRowid;
  });
  assert.equal(calls, 3);
  assert.equal(db.prepare('SELECT name FROM items WHERE id = ?').get(id).name, 'fresh');
});

test('retryOnCollision gives up after the last attempt and rethrows other errors at once', () => {
  const db = constrainedDb();
  let calls = 0;
  assert.throws(
    () =>
      retryOnCollision(4, 'items.name', () => {
        calls += 1;
        db.exec("INSERT INTO items (name, size) VALUES ('a', 1)");
      }),
    (error) => isUniqueViolation(error, 'items.name'),
  );
  assert.equal(calls, 4);
  calls = 0;
  assert.throws(
    () =>
      retryOnCollision(4, 'items.name', () => {
        calls += 1;
        db.exec("INSERT INTO items (name, size) VALUES ('b', 0)");
      }),
    { code: 'SQLITE_CONSTRAINT_CHECK' },
  );
  assert.equal(calls, 1, 'a CHECK failure is not retried');
});
