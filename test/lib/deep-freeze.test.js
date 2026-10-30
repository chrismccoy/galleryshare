import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze } from '../../lib/deep-freeze.js';
import { NAV_GROUPS } from '../../config/navigation.js';

test('deepFreeze freezes nested objects and arrays but leaves Buffers alone', () => {
  const key = Buffer.alloc(32, 1);
  const value = deepFreeze({ a: { b: [1, { c: 2 }] }, key });
  assert.ok(Object.isFrozen(value.a.b[1]));
  assert.ok(!Object.isFrozen(key));
  assert.throws(() => {
    'use strict';
    value.a.b.push(3);
  }, TypeError);
});

test('shared vocabulary and navigation cannot be changed by any module', () => {
  assert.ok(Object.isFrozen(NAV_GROUPS), 'NAV_GROUPS is frozen');
  assert.ok(Object.isFrozen(NAV_GROUPS[0].links[0]));
  assert.throws(() => NAV_GROUPS[0].links.push({}), TypeError);
});
