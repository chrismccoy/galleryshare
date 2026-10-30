import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { createTransactionRunner } from '../../db/database.js';

function setup() {
  const db = freshDb();
  db.exec('CREATE TABLE t (v TEXT)');
  return { db, run: createTransactionRunner(db), calls: [] };
}

test('afterCommit runs at once outside a transaction', () => {
  const { run, calls } = setup();
  run.afterCommit(() => calls.push('now'));
  assert.deepEqual(calls, ['now']);
});

test('afterCommit waits for the commit and runs in order', () => {
  const { db, run, calls } = setup();
  const result = run(() => {
    db.prepare("INSERT INTO t VALUES ('a')").run();
    run.afterCommit(() => calls.push(`first, in transaction: ${db.inTransaction}`));
    run.afterCommit(() => calls.push('second'));
    assert.deepEqual(calls, [], 'nothing runs before the commit');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(calls, ['first, in transaction: false', 'second']);
});

test('afterCommit callbacks are dropped when the transaction rolls back', () => {
  const { db, run, calls } = setup();
  assert.throws(
    () =>
      run(() => {
        db.prepare("INSERT INTO t VALUES ('a')").run();
        run.afterCommit(() => calls.push('dropped'));
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.deepEqual(calls, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 0);
  run.afterCommit(() => calls.push('later'));
  assert.deepEqual(calls, ['later'], 'the queue is cleared after a rollback');
});

test('a rolled-back savepoint drops only its own callbacks', () => {
  const { run, calls } = setup();
  run(() => {
    run.afterCommit(() => calls.push('outer'));
    assert.throws(() =>
      run(() => {
        run.afterCommit(() => calls.push('inner'));
        throw new Error('inner fails');
      }),
    );
    run(() => run.afterCommit(() => calls.push('inner kept')));
  });
  assert.deepEqual(calls, ['outer', 'inner kept']);
});

test('a throwing callback neither fails the commit nor skips the others', () => {
  const { db, run, calls } = setup();
  run(() => {
    db.prepare("INSERT INTO t VALUES ('a')").run();
    run.afterCommit(() => {
      throw new Error('log failed');
    });
    run.afterCommit(() => calls.push('still runs'));
  });
  assert.deepEqual(calls, ['still runs']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
});
