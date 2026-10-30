import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkQueue } from '../../lib/work-queue.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('jobs run one at a time in insertion order by default, and idle waits for the last one', async () => {
  const log = [];
  const queue = createWorkQueue({
    run: async (key) => {
      log.push(`start ${key}`);
      await new Promise((resolve) => setImmediate(resolve));
      log.push(`end ${key}`);
    },
  });
  queue.add('a', null);
  queue.add('b', null);
  queue.add('c', null);
  assert.equal(queue.size(), 3);
  assert.deepEqual(log, [], 'nothing starts in the same turn');
  await queue.idle();
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  assert.equal(queue.size(), 0);
});

test('no more than `concurrency` jobs run at once, and each gets its payload', async () => {
  const gates = { a: deferred(), b: deferred(), c: deferred() };
  const seen = [];
  let running = 0;
  let most = 0;
  const queue = createWorkQueue({
    concurrency: 2,
    run: async (key, payload) => {
      seen.push([key, payload]);
      running += 1;
      most = Math.max(most, running);
      await gates[key].promise;
      running -= 1;
    },
  });
  queue.add('a', 1);
  queue.add('b', 2);
  queue.add('c', 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [
    ['a', 1],
    ['b', 2],
  ]);
  gates.a.resolve();
  gates.b.resolve();
  gates.c.resolve();
  await queue.idle();
  assert.deepEqual(seen.at(-1), ['c', 3]);
  assert.equal(most, 2);
});

test('idle resolves at once on an empty queue', async () => {
  const queue = createWorkQueue({
    run: () => {},
  });
  assert.equal(await queue.idle(), undefined);
});

test('a job that throws is handed to onError and the queue carries on', async () => {
  const errors = [];
  const done = [];
  const queue = createWorkQueue({
    run: (key) => {
      if (key === 'bad') throw new Error('boom');
      done.push(key);
    },
    onError: (error, key) => errors.push([key, error.message]),
  });
  queue.add('bad', null);
  queue.add('good', null);
  await queue.idle();
  assert.deepEqual(errors, [['bad', 'boom']]);
  assert.deepEqual(done, ['good']);
});

test('a key cannot be queued twice while its job is queued or running', async () => {
  const queue = createWorkQueue({
    run: async () => {},
  });
  queue.add(1, null);
  assert.throws(() => queue.add(1, null), /already queued/);
  await queue.idle();
  queue.add(1, null);
  await queue.idle();
});

test('with concurrency above 1, a long job at the head does not hold back the jobs behind it', async () => {
  const gate = deferred();
  const started = [];
  const queue = createWorkQueue({
    concurrency: 2,
    run: async (key) => {
      started.push(key);
      if (key === 'a') await gate.promise;
    },
  });
  for (const key of ['a', 'b', 'c', 'd']) queue.add(key, null);
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c', 'd'], 'c and d ran in the second slot while a was still running');
  assert.equal(queue.size(), 1);
  gate.resolve();
  await queue.idle();
});
