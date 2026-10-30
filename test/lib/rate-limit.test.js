import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitRepository } from '../../db/rate-limit.repository.js';
import { createRateLimiter } from '../../lib/rate-limit.js';
import { freshDb } from '../helpers/db.js';
import { buildContext } from '../helpers/context.js';
import { fakeClock } from '../helpers/clock.js';

test('rate limiter blocks the max+1-th call, resets after the window', () => {
  const db = freshDb();
  const clock = fakeClock(1000);
  const limiter = createRateLimiter({
    repository: createRateLimitRepository(db),
    windowMs: 1000,
    max: 3,
    now: clock.now,
  });
  for (let i = 0; i < 3; i++) assert.equal(limiter.check('k').allowed, true);
  const blocked = limiter.check('k');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(limiter.check('other').allowed, true);
  clock.tick(1000);
  assert.equal(limiter.check('k').allowed, true);
});

test('rate-limit repository counts hits, sweeps ended windows and clears', () => {
  const db = freshDb();
  const repo = createRateLimitRepository(db);
  assert.deepEqual(repo.hit('a', 1000, 500), { count: 1, expiresAt: 1500 });
  assert.deepEqual(repo.hit('a', 1200, 9999), { count: 2, expiresAt: 1500 });
  assert.deepEqual(repo.hit('b', 1000, 2000), { count: 1, expiresAt: 3000 });
  assert.equal(repo.count(), 2);
  assert.equal(repo.sweep(1500), 1);
  assert.equal(repo.count(), 1);
  repo.clear();
  assert.equal(repo.count(), 0);
});

test('the app context limiters read the context clock', () => {
  const clock = fakeClock('2026-01-01T00:00:00Z');
  const { context } = buildContext({
    env: { RATE_LIMIT_SHARE_MAX: '1', RATE_LIMIT_WINDOW_MS: '1000' },
    now: clock.now,
  });
  assert.equal(context.shareLimiter.check('k').allowed, true);
  assert.equal(context.shareLimiter.check('k').allowed, false);
  clock.tick(1000);
  assert.equal(context.shareLimiter.check('k').allowed, true, 'the window ends on the context clock');
});

test('firstRefusal is true only for the hit just past the allowance in a window', () => {
  const clock = fakeClock(1000);
  const limiter = createRateLimiter({
    repository: createRateLimitRepository(freshDb()),
    windowMs: 1000,
    max: 2,
    now: clock.now,
  });
  const flags = Array.from({ length: 5 }, () => limiter.check('k').firstRefusal);
  assert.deepEqual(flags, [false, false, true, false, false]);
  clock.tick(1000);
  assert.deepEqual([limiter.check('k').firstRefusal, limiter.check('k').firstRefusal], [false, false]);
});
