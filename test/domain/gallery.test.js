import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAPTION_TEMPLATE,
  DEFAULT_GALLERY_TITLE,
  DEFAULT_IMAGE_TITLE,
  defaultCaption,
  editedByAdmin,
  galleryTitle,
  imageTitle,
  imageCaption,
  newPublicName,
  zipEntryName,
  zipOffered,
  isWritten,
  GALLERY_GRID_TEXT_CHOICES,
  GRID_TEXT_MESSAGE,
  gridTextChoice,
  gridTextColumn,
  gridTextLabel,
  gridTextShown,
} from '../../domain/gallery.js';
import { FOLLOW_SITE } from '../../domain/gallery-choice.js';

test('defaults apply to blank values only', () => {
  assert.equal(DEFAULT_GALLERY_TITLE, 'Untitled gallery');
  assert.equal(DEFAULT_IMAGE_TITLE, 'Title');
  assert.equal(galleryTitle({ title: null }), 'Untitled gallery');
  assert.equal(galleryTitle({ title: '   ' }), 'Untitled gallery');
  assert.equal(galleryTitle({ title: 'Trip' }), 'Trip');
  assert.equal(imageTitle({ title: '' }), null, 'no title shown when none is set');
  assert.equal(imageTitle({ title: null }), null);
  assert.equal(imageTitle({ title: 'Sunset' }), 'Sunset');
  assert.equal(imageCaption({ caption: null }, 3), 'Image #3');
  assert.equal(imageCaption({ caption: ' ' }, 1), 'Image #1');
  assert.equal(imageCaption({ caption: 'Hi' }, 3), 'Hi');
});

test('the default caption fills the position into DEFAULT_CAPTION_TEMPLATE', () => {
  assert.equal(DEFAULT_CAPTION_TEMPLATE, 'Image #{position}');
  assert.equal(defaultCaption(12), 'Image #12');
  assert.equal(imageCaption(null, 12), defaultCaption(12));
});

test('editedByAdmin: true only when someone other than the owner made the last change', () => {
  assert.equal(editedByAdmin({ user_id: 1, updated_by: 2 }), true);
  assert.equal(editedByAdmin({ user_id: 1, updated_by: 1 }), false);
  assert.equal(editedByAdmin({ user_id: 1, updated_by: null }), false);
  assert.equal(editedByAdmin({ user_id: 1 }), false);
});

test('zipEntryName pads position to three digits', () => {
  assert.equal(zipEntryName({ public_name: 'k3Rf9Qa2xZ', ext: 'jpg' }, 1), 'k3Rf9Qa2xZ-001.jpg');
  assert.equal(zipEntryName({ public_name: 'k3Rf9Qa2xZ', ext: 'png' }, 1234), 'k3Rf9Qa2xZ-1234.png');
});

test('newPublicName is 10 base62 chars and varies', () => {
  const names = new Set();
  for (let i = 0; i < 50; i++) {
    const n = newPublicName();
    assert.match(n, /^[0-9A-Za-z]{10}$/);
    names.add(n);
  }
  assert.ok(names.size > 40);
});

test('grid text choices: site default, show or hide; the form shows a stored value as its choice', () => {
  assert.deepEqual(GALLERY_GRID_TEXT_CHOICES, [FOLLOW_SITE, 'show', 'hide']);
  assert.equal(GRID_TEXT_MESSAGE, 'Choose how the gallery grid shows titles and captions.');
  assert.equal(gridTextChoice({ grid_text: null }), FOLLOW_SITE);
  assert.equal(gridTextChoice({}), FOLLOW_SITE);
  assert.equal(gridTextChoice({ grid_text: 1 }), 'show');
  assert.equal(gridTextChoice({ grid_text: 0 }), 'hide');
  assert.equal(gridTextLabel(true), 'Shown');
  assert.equal(gridTextLabel(false), 'Hidden');
});

test('gridTextShown: the gallery choice wins; site default follows the site setting', () => {
  for (const site of [true, false]) {
    assert.equal(gridTextShown({ grid_text: null }, site), site);
    assert.equal(gridTextShown({ grid_text: 1 }, site), true);
    assert.equal(gridTextShown({ grid_text: 0 }, site), false);
  }
});

test('gridTextColumn gives the stored grid_text value of each choice', () => {
  assert.equal(gridTextColumn(FOLLOW_SITE), null);
  assert.equal(gridTextColumn('show'), 1);
  assert.equal(gridTextColumn('hide'), 0);
  for (const bad of ['', 'Show', 'maybe', undefined, null, 1])
    assert.equal(gridTextColumn(bad), undefined, String(bad));
  assert.equal(gridTextColumn('toString'), undefined, 'inherited names are not choices');
});

test('zipOffered: only when the owner allowed it and the visitor can see at least one image', () => {
  assert.equal(zipOffered({ allow_zip: 1 }, 3), true);
  assert.equal(zipOffered({ allow_zip: 1 }, 0), false, 'nothing to download');
  assert.equal(zipOffered({ allow_zip: 0 }, 3), false);
});

test('isWritten: an image counts as written once any of its byte counts is set', () => {
  assert.equal(
    isWritten({ bytes_orig: 0, bytes_web: 0, bytes_thumb: 0 }),
    false,
    'a row whose files are being written',
  );
  assert.equal(isWritten({ bytes_orig: 10, bytes_web: 0, bytes_thumb: 0 }), true);
  assert.equal(isWritten({ bytes_orig: 0, bytes_web: 0, bytes_thumb: 3 }), true);
});
