import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCookie } from '../../lib/cookies.js';

test('readCookie finds one cookie by name and URL-decodes it', () => {
  assert.equal(readCookie('a=1; sid=abc%20d; pre=x', 'sid'), 'abc d');
  assert.equal(readCookie(' sid = v ', 'sid'), 'v');
});

test('readCookie gives null for a missing header, a missing cookie or an undecodable value', () => {
  assert.equal(readCookie(undefined, 'sid'), null);
  assert.equal(readCookie('', 'sid'), null);
  assert.equal(readCookie('other=1; novalue', 'sid'), null);
  assert.equal(readCookie('sid=%E0%A4%A', 'sid'), null);
});
