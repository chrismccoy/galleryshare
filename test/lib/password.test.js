import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../lib/password.js';

test('password round-trip and rejection', async () => {
  const h = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(await verifyPassword('x', null), false);
});

test('password hashes record their scrypt parameters; legacy salt:key hashes still verify', async () => {
  const { scryptSync, randomBytes } = await import('node:crypto');
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  const salt = randomBytes(16);
  const legacy = `${salt.toString('hex')}:${scryptSync('old password', salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
  assert.equal(await verifyPassword('old password', legacy), true);
  assert.equal(await verifyPassword('wrong', legacy), false);
  const parts = h.split('$');
  assert.equal(await verifyPassword('correct horse', ['scrypt', String(2 ** 30), ...parts.slice(2)].join('$')), false);
  assert.equal(await verifyPassword('correct horse', ['scrypt', '1000', ...parts.slice(2)].join('$')), false);
  assert.equal(await verifyPassword('correct horse', `${h}$extra`), false);
});

test('a stored hash cannot make verification use more than 128 MiB of scrypt memory', async () => {
  const { scryptSync, randomBytes } = await import('node:crypto');
  const hashWith = (N, r) => {
    const salt = randomBytes(16);
    const key = scryptSync('pw', salt, 64, { N, r, p: 1, maxmem: 128 * N * r + 1024 * 1024 });
    return `scrypt$${N}$${r}$1$${salt.toString('hex')}$${key.toString('hex')}`;
  };
  assert.equal(await verifyPassword('pw', hashWith(2 ** 17, 8)), true);
  assert.equal(await verifyPassword('pw', hashWith(2 ** 17, 16)), false);
});
