import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_VIEW,
  GALLERY_IMAGE_VIEW_CHOICES,
  IMAGE_VIEWS,
  imageViewChoice,
  imageViewFor,
  imageViewFromChoice,
  imageViewLabel,
  isImageView,
} from '../../domain/image-views.js';

test('the views are Lightbox, New tab and Image page, frozen; Lightbox is the default', () => {
  assert.deepEqual(
    IMAGE_VIEWS.map((view) => [view.key, view.label]),
    [
      ['lightbox', 'Lightbox'],
      ['new-tab', 'New tab'],
      ['page', 'Image page'],
    ],
  );
  assert.ok(Object.isFrozen(IMAGE_VIEWS) && IMAGE_VIEWS.every(Object.isFrozen));
  assert.equal(DEFAULT_IMAGE_VIEW, 'lightbox');
  assert.equal(isImageView('page'), true);
  assert.equal(isImageView('Page'), false);
  assert.equal(imageViewLabel('new-tab'), 'New tab');
});

test("a gallery's view choice: 'default' follows the site; its own view wins; never an unknown key", () => {
  assert.deepEqual(GALLERY_IMAGE_VIEW_CHOICES, ['default', 'lightbox', 'new-tab', 'page']);
  assert.equal(imageViewFromChoice('default'), null);
  assert.equal(imageViewFromChoice('page'), 'page');
  assert.equal(imageViewFromChoice('popup'), undefined);
  assert.equal(imageViewChoice({ image_view: null }), 'default');
  assert.equal(imageViewChoice({ image_view: 'new-tab' }), 'new-tab');
  assert.equal(imageViewFor({ image_view: 'page' }, 'lightbox'), 'page');
  assert.equal(imageViewFor({ image_view: null }, 'new-tab'), 'new-tab');
  assert.equal(imageViewFor({ image_view: 'gone' }, 'gone'), 'lightbox');
});
