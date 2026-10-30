import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGalleryPath } from '../../routes/middleware/static-files.js';

test('isGalleryPath decodes, ignores case and treats a malformed encoding as the gallery', () => {
  for (const p of [
    '/screenshots',
    '/screenshots/a.jpg',
    '/%73creenshots/a.jpg',
    '/SCREENSHOTS/x',
    '//screenshots/x',
    '/%E0%A4%A',
  ]) {
    assert.equal(isGalleryPath(p), true, p);
  }
  for (const p of ['/', '/js/reorder.js', '/screenshotsx/a', '/css/screenshots.css'])
    assert.equal(isGalleryPath(p), false, p);
});
