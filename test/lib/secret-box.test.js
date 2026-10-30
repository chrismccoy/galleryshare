import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, parseKey } from '../../lib/secret-box.js';

test('encrypt/decrypt round-trip with the right key and give null for a wrong key, tampering or bad input', () => {
  const k1 = Buffer.alloc(32, 1);
  const k2 = Buffer.alloc(32, 2);
  const enc = encrypt('sk-x', k1);
  assert.ok(enc.startsWith('enc:v1:'));
  assert.equal(decrypt(enc, k1), 'sk-x');
  assert.equal(decrypt(enc, k2), null);
  assert.equal(decrypt(enc.slice(0, -4) + 'AAAA', k1), null);
  assert.equal(decrypt('plain', k1), null);
  assert.equal(decrypt('enc:v1:', k1), null);
  assert.equal(decrypt(null, k1), null);
  assert.equal(decrypt(enc, null), null);
  assert.throws(() => encrypt('x', null));
});

test('parseKey reads a 64-hex or 32-byte base64 key and gives null for anything else', () => {
  assert.equal(parseKey('ab'.repeat(32)).length, 32);
  assert.equal(parseKey(Buffer.alloc(32, 3).toString('base64')).length, 32);
  assert.equal(parseKey('short'), null);
  assert.equal(parseKey(undefined), null);
});
