import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryEventFields } from '../../domain/gallery-activity.js';

const gallery = { id: 7, user_id: 1, title: null };

test('the owner acting is not named again as the subject; the gallery gets its display title', () => {
  const owner = { id: 1, role: 'user' };
  assert.deepEqual(galleryEventFields(owner, gallery), {
    actor: owner,
    subject: null,
    gallery: { id: 7, title: 'Untitled gallery' },
  });
  assert.equal(galleryEventFields(1, gallery).subject, null, 'an id works like a row');
});

test('someone else acting names the owner as the subject: an admin, or the system (null)', () => {
  assert.equal(galleryEventFields({ id: 2, role: 'admin' }, gallery).subject, 1);
  assert.equal(galleryEventFields(2, gallery).subject, 1);
  const bySystem = galleryEventFields(null, { ...gallery, title: 'Trip' });
  assert.deepEqual(bySystem, { actor: null, subject: 1, gallery: { id: 7, title: 'Trip' } });
});
