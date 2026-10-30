import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE62, hashToken, newToken, randomBase62, sha256Hex } from '../../lib/tokens.js';

test('newToken gives 43 base64url characters, different each call; sha256Hex is stable lowercase hex', () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(t, newToken());
  assert.equal(sha256Hex('a'), sha256Hex('a'));
  assert.match(sha256Hex('a'), /^[0-9a-f]{64}$/);
  assert.notEqual(sha256Hex('a'), sha256Hex('b'));
});

test('hashToken is sha256Hex of the token text', () => {
  assert.equal(hashToken('abc'), sha256Hex('abc'));
  assert.equal(hashToken(123), sha256Hex('123'));
});

test('sha256Hex matches the standard SHA-256 test vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('randomBase62 draws the given number of base-62 characters', () => {
  assert.equal(BASE62.length, 62);
  assert.equal(new Set(BASE62).size, 62);
  for (const length of [0, 1, 10, 64]) {
    const text = randomBase62(length);
    assert.equal(text.length, length);
    assert.match(text, /^[0-9A-Za-z]*$/);
  }
  assert.notEqual(randomBase62(20), randomBase62(20));
});
