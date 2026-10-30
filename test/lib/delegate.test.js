import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delegateMethods } from '../../lib/delegate.js';

test('delegateMethods passes the named methods through and leaves the rest out', () => {
  const repo = {
    add: (a, b) => a + b,
    secret: () => 'no',
  };
  const delegated = delegateMethods(repo, ['add']);
  assert.deepEqual(Object.keys(delegated), ['add']);
  assert.equal(delegated.add(2, 3), 5);
});

test('delegateMethods looks the method up on every call', () => {
  const repo = {
    read: () => 'old',
  };
  const delegated = delegateMethods(repo, ['read']);
  repo.read = () => 'new';
  assert.equal(delegated.read(), 'new');
});

test('delegateMethods refuses a name the source has no method for', () => {
  assert.throws(
    () =>
      delegateMethods(
        {
          read: () => 1,
        },
        ['reed'],
      ),
    /reed/,
  );
});
