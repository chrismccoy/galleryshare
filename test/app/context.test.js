import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiters, resolveSecret } from '../../app/context.js';
import { recordingLogger } from '../helpers/logger.js';

test('resolveSecret uses SESSION_SECRET when set and warns about a random one otherwise', () => {
  const set = recordingLogger();
  assert.equal(resolveSecret({ session: { secret: 'configured' } }, set.logger), 'configured');
  assert.equal(set.warn.length, 0);

  const unset = recordingLogger();
  const first = resolveSecret({ session: { secret: '' } }, unset.logger);
  const second = resolveSecret({ session: { secret: '' } }, unset.logger);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second, 'a fresh random secret each time');
  assert.equal(unset.warn.length, 2);
  assert.match(unset.warn[0][0], /SESSION_SECRET is not set/);
});

test('createLimiters builds the three limiters on one repository and window, each with its own max', () => {
  const hits = [];
  const repository = {
    hit: (key, time, windowMs) => {
      hits.push([key, windowMs]);
      return { count: hits.filter(([k]) => k === key).length, expiresAt: time + windowMs };
    },
    sweep: () => {},
  };
  const now = () => new Date(0);
  const limiters = createLimiters(repository, { publicFormMax: 1, shareMax: 2, zipMax: 3, windowMs: 1000 }, now);
  assert.deepEqual(Object.keys(limiters).sort(), ['publicFormLimiter', 'shareLimiter', 'zipLimiter']);
  assert.equal(limiters.publicFormLimiter.check('a').remaining, 0);
  assert.equal(limiters.shareLimiter.check('b').remaining, 1);
  assert.equal(limiters.zipLimiter.check('c').remaining, 2);
  assert.deepEqual(
    hits.map(([, windowMs]) => windowMs),
    [1000, 1000, 1000],
  );
});
