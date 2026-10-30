import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedText, digitsInt, isBlank, mergePresent, wholeNumberOrBlank } from '../../lib/params.js';
import { ValidationError } from '../../lib/errors.js';

test('isBlank is true for undefined, null and the empty string only', () => {
  for (const blank of [undefined, null, '']) assert.equal(isBlank(blank), true, String(blank));
  for (const value of [' ', '0', 0, false, 'x']) assert.equal(isBlank(value), false, String(value));
});

test('digitsInt reads text made only of digits, as is, and gives null for anything else', () => {
  assert.equal(digitsInt('42'), 42);
  assert.equal(digitsInt('007'), 7);
  assert.equal(digitsInt('0'), 0);
  for (const bad of ['', ' 4', '4 ', '-1', '1.5', '1e3', 'abc', '12x', undefined, null]) {
    assert.equal(digitsInt(bad), null, String(bad));
  }
});

test('wholeNumberOrBlank reads digits, gives null for blank and throws the given message for anything else', () => {
  const message = 'Enter a whole number.';
  assert.equal(wholeNumberOrBlank(' 42 ', message), 42);
  assert.equal(wholeNumberOrBlank('0', message), 0);
  assert.equal(wholeNumberOrBlank(7, message), 7);
  assert.equal(wholeNumberOrBlank('', message), null);
  assert.equal(wholeNumberOrBlank('   ', message), null);
  assert.equal(wholeNumberOrBlank(undefined, message), null);
  assert.equal(wholeNumberOrBlank(null, message), null);
  for (const bad of ['-1', '1.5', '1e3', 'abc', '12x']) {
    assert.throws(() => wholeNumberOrBlank(bad, message), { name: 'ValidationError', message }, bad);
  }
});

test('boundedText trims, enforces the maximum, and the minimum when required', () => {
  assert.equal(boundedText('  hi  ', 5, 'Too long.'), 'hi');
  assert.equal(boundedText(undefined, 5, 'Too long.'), '');
  assert.equal(boundedText(null, 5, 'Too long.'), '');
  assert.equal(boundedText('abcde', 5, 'Too long.'), 'abcde');
  assert.throws(
    () => boundedText('abcdef', 5, 'Too long.'),
    (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, 'Too long.');
      return true;
    },
  );
  assert.equal(boundedText(' a ', 5, 'Enter one.', { required: true }), 'a');
  assert.throws(() => boundedText('   ', 5, 'Enter one.', { required: true }), { message: 'Enter one.' });
});

test('boundedText with blankAsNull gives null for empty text and still enforces the maximum', () => {
  assert.equal(boundedText('   ', 5, 'Too long.', { blankAsNull: true }), null);
  assert.equal(boundedText(undefined, 5, 'Too long.', { blankAsNull: true }), null);
  assert.equal(boundedText(' hi ', 5, 'Too long.', { blankAsNull: true }), 'hi');
  assert.throws(() => boundedText('abcdef', 5, 'Too long.', { blankAsNull: true }), { message: 'Too long.' });
});

test('mergePresent cleans the fields that are present and keeps the current value of the others', () => {
  const current = { title: 'Old', caption: 'Keep' };
  const trim = (value) => String(value).trim();
  const orNull = (value) => value ?? null;
  const cleaners = { title: trim, caption: trim };
  assert.deepEqual(mergePresent({ title: ' New ' }, current, cleaners), { title: 'New', caption: 'Keep' });
  assert.deepEqual(mergePresent({ title: undefined }, current, { title: orNull }), { title: null });
  assert.deepEqual(mergePresent({ other: 'x' }, current, cleaners), current, 'unknown fields are ignored');
  assert.deepEqual(mergePresent(Object.create({ title: 'inherited' }), current, cleaners), current, 'own fields only');
});
