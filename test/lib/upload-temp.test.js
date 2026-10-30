import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTempName, newTempName } from '../../lib/upload-temp.js';

test('newTempName gives 32 lower-case hex characters that isTempName accepts, a new one each time', () => {
  const name = newTempName();
  assert.match(name, /^[0-9a-f]{32}$/);
  assert.equal(isTempName(name), true);
  assert.notEqual(newTempName(), name);
});

test('isTempName refuses anything else boot cleanup might find in the folder', () => {
  for (const name of ['', 'notes.txt', 'A'.repeat(32), `${'a'.repeat(32)}.jpg`, 'a'.repeat(31), '.gitkeep']) {
    assert.equal(isTempName(name), false, name);
  }
});
