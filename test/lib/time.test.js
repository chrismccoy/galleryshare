import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND, isoAfter, nowIso, systemNow, toIso } from '../../lib/time.js';

test('MS_PER_SECOND, MS_PER_HOUR and MS_PER_DAY are a second, an hour and a day in milliseconds', () => {
  assert.equal(MS_PER_SECOND, 1000);
  assert.equal(MS_PER_HOUR, 3_600_000);
  assert.equal(MS_PER_DAY, 86_400_000);
});

test('isoAfter adds or subtracts a duration and returns ISO UTC', () => {
  const start = new Date('2026-10-27T12:00:00.000Z');
  assert.equal(isoAfter(start, MS_PER_DAY), '2026-10-28T12:00:00.000Z');
  assert.equal(isoAfter(start, -30 * MS_PER_DAY), '2026-09-27T12:00:00.000Z');
  assert.equal(isoAfter(start, 24 * MS_PER_HOUR), '2026-10-28T12:00:00.000Z');
});

test('toIso formats a Date, a date string or epoch milliseconds as ISO UTC', () => {
  const iso = '2026-10-27T12:00:00.000Z';
  assert.equal(toIso(new Date(iso)), iso);
  assert.equal(toIso('2026-10-27T14:00:00+02:00'), iso);
  assert.equal(toIso(Date.parse(iso)), iso);
});

test('systemNow returns a new Date at the current time on every call', () => {
  const before = Date.now();
  const first = systemNow();
  const after = Date.now();
  assert.ok(first instanceof Date);
  assert.ok(first.getTime() >= before && first.getTime() <= after);
  assert.notEqual(systemNow(), first, 'a fresh Date each call, so callers cannot share one by mutation');
});

test('nowIso formats the given clock as an ISO-8601 UTC string', () => {
  assert.equal(
    nowIso(() => new Date('2026-01-02T03:04:05.006Z')),
    '2026-01-02T03:04:05.006Z',
  );
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'defaults to the real clock');
});
