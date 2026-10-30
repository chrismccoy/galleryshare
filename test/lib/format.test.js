import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatUtc, formatUtcDate, purgeDate } from '../../lib/format.js';

test('formatUtcDate prints the UTC calendar date', () => {
  assert.equal(formatUtcDate('2026-10-27T23:59:59.999Z'), '2026-10-27');
  assert.equal(formatUtcDate(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01');
  assert.equal(formatUtcDate(Date.parse('2026-03-05T12:00:00.000Z')), '2026-03-05');
  assert.equal(formatUtcDate(''), '');
  assert.equal(formatUtcDate(null), '');
  assert.equal(formatUtcDate('not a date'), '');
});

test('purgeDate adds the retention days to the trashed time, in UTC', () => {
  assert.equal(purgeDate('2026-10-20T08:30:00.000Z', 30), '2026-11-19');
  assert.equal(purgeDate('2026-12-30T23:00:00.000Z', 7), '2027-01-06');
  assert.equal(purgeDate('2026-02-27T12:00:00.000Z', 1), '2026-02-28');
  assert.equal(purgeDate(null, 30), '');
});

test('formatUtc prints minutes in UTC and is empty for missing or bad values', () => {
  assert.equal(formatUtc('2026-10-27T14:03:59.000Z'), '2026-10-27 14:03 UTC');
  assert.equal(formatUtc(null), '');
  assert.equal(formatUtc('not a date'), '');
});

test('formatBytes: B, KB, MB, GB with one decimal', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(1.25 * 1024 ** 3), '1.3 GB');
  assert.equal(formatBytes(null), '0 B');
});
