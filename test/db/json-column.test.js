import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonColumn, writeJsonColumn } from '../../db/json-column.js';

test('a value written to a JSON column reads back the same', () => {
  for (const value of [[{ name: 'a.jpg', reason: 'unreadable' }], { on: true }, 12, 'text', false, null]) {
    assert.deepEqual(readJsonColumn(writeJsonColumn(value)), value);
  }
  assert.equal(writeJsonColumn([1, 2]), '[1,2]');
});

test('an empty column or a missing row reads as null', () => {
  assert.equal(readJsonColumn(null), null);
  assert.equal(readJsonColumn(undefined), null);
});
