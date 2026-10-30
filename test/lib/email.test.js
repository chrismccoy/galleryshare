import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_PATTERN, normalizeEmail } from '../../lib/email.js';

test('normalizeEmail trims and lowercases, and turns a missing value into an empty string', () => {
  assert.equal(normalizeEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(null), '');
});

test('EMAIL_PATTERN accepts something@something.tld and rejects spaces or a missing part', () => {
  assert.ok(EMAIL_PATTERN.test('ada@example.com'));
  for (const bad of ['ada', 'ada@example', '@example.com', 'a da@example.com', 'ada@exa mple.com']) {
    assert.ok(!EMAIL_PATTERN.test(bad), bad);
  }
});
