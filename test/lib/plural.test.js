import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural } from '../../lib/plural.js';

test('plural adds an s to a regular noun unless the count is 1', () => {
  assert.equal(plural(1, 'image'), '1 image');
  assert.equal(plural(0, 'image'), '0 images');
  assert.equal(plural(3, 'image text'), '3 image texts');
});

test('plural takes an irregular plural form', () => {
  assert.equal(plural(1, 'gallery', 'galleries'), '1 gallery');
  assert.equal(plural(2, 'gallery', 'galleries'), '2 galleries');
  assert.equal(plural(4, 'more file was', 'more files were'), '4 more files were');
});
