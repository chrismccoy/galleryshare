import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitRepository } from '../../db/rate-limit.repository.js';
import { createRateLimiter } from '../../lib/rate-limit.js';
import { TOO_MANY, rateLimit } from '../../routes/middleware/rate-limit.js';
import { fakeClock } from '../helpers/clock.js';
import { freshDb } from '../helpers/db.js';
import { fakeResponse } from '../helpers/fake-response.js';

test('rateLimit middleware answers 429 with Retry-After', () => {
  const db = freshDb();
  const limiter = createRateLimiter({
    repository: createRateLimitRepository(db),
    windowMs: 1000,
    max: 1,
    now: () => new Date(5),
  });
  const mw = rateLimit({
    limiter,
    key: () => 'a',
  });
  const run = () => {
    const { res, out } = fakeResponse();
    out.nexted = false;
    mw({}, res, () => {
      out.nexted = true;
    });
    return out;
  };
  assert.equal(run().nexted, true);
  const second = run();
  assert.equal(second.status, 429);
  assert.equal(second.nexted, false);
  assert.ok(second.headers['Retry-After']);
  assert.deepEqual(second.body, { error: TOO_MANY }, 'the default refusal text is TOO_MANY');
});

function oneRequestLimiter() {
  return createRateLimiter({
    repository: createRateLimitRepository(freshDb()),
    windowMs: 1000,
    max: 1,
    now: () => new Date(5),
  });
}

test('rateLimit hands the refusal to its onRefused handler, with or without its own message, as (req, res, { status, error, resetInSeconds })', () => {
  const key = () => 'a';
  const seen = [];
  const handler = (req, res, refusal) => {
    seen.push(refusal);
    return 'refused';
  };
  const custom = rateLimit({ limiter: oneRequestLimiter(), key, message: 'Slow down.', onRefused: handler });
  const form = rateLimit({ limiter: oneRequestLimiter(), key, onRefused: handler });
  for (const mw of [custom, form]) {
    const { res } = fakeResponse();
    mw({}, res, () => {});
    assert.equal(
      mw({}, res, () => assert.fail('a refused request must not continue')),
      'refused',
    );
  }
  assert.deepEqual(
    seen.map(({ status, error }) => ({ status, error })),
    [
      { status: 429, error: 'Slow down.' },
      { status: 429, error: TOO_MANY },
    ],
  );
  assert.ok(seen.every(({ resetInSeconds }) => Number.isInteger(resetInSeconds)));
});

test('a refusal records a rateLimitHit event naming the limiter, from the visitor address', () => {
  const recorded = [];
  const mw = rateLimit({
    limiter: oneRequestLimiter(),
    key: () => 'a',
    name: 'sign-in form',
    activityService: {
      record: (event) => recorded.push(event),
    },
  });
  const { res } = fakeResponse();
  const req = () => ({
    ip: '203.0.113.9',
    get: () => 'Mozilla/5.0 Firefox/120.0',
  });
  mw(req(), res, () => {});
  assert.deepEqual(recorded, [], 'an allowed request records nothing');
  mw(req(), res, () => {});
  assert.deepEqual(recorded, [
    {
      kind: 'rateLimitHit',
      actor: 'visitor',
      details: 'sign-in form',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 Firefox/120.0',
    },
  ]);
});

test('only the first refusal of each window per key records a rateLimitHit', () => {
  const clock = fakeClock(1000);
  const limiter = createRateLimiter({
    repository: createRateLimitRepository(freshDb()),
    windowMs: 1000,
    max: 1,
    now: clock.now,
  });
  const recorded = [];
  const mw = rateLimit({
    limiter,
    key: (req) => req.who,
    name: 'share links',
    activityService: {
      record: (event) => recorded.push(event),
    },
  });
  const hit = (who) => mw({ who, ip: '203.0.113.9' }, fakeResponse().res, () => {});
  for (let i = 0; i < 6; i++) hit('a');
  assert.equal(recorded.length, 1, 'five refusals, one row');
  hit('b');
  hit('b');
  hit('b');
  assert.equal(recorded.length, 2, 'another key is recorded once too');
  clock.tick(1000);
  for (let i = 0; i < 4; i++) hit('a');
  assert.equal(recorded.length, 3, 'a new window records again, once');
});
