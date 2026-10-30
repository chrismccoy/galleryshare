import { createKeyedChoice } from './gallery-choice.js';

export const IMAGE_VIEW_KEYS = Object.freeze({ lightbox: 'lightbox', newTab: 'new-tab', page: 'page' });

export const IMAGE_VIEWS = Object.freeze([
  Object.freeze({ key: IMAGE_VIEW_KEYS.lightbox, label: 'Lightbox' }),
  Object.freeze({ key: IMAGE_VIEW_KEYS.newTab, label: 'New tab' }),
  Object.freeze({ key: IMAGE_VIEW_KEYS.page, label: 'Image page' }),
]);

export const DEFAULT_IMAGE_VIEW = IMAGE_VIEW_KEYS.lightbox;

export const IMAGE_VIEW_MESSAGE = `Choose an image view: ${IMAGE_VIEWS.map((view) => view.key).join(', ')}.`;

export const IMAGE_VIEW_CHOICE = createKeyedChoice({
  options: IMAGE_VIEWS,
  defaultKey: DEFAULT_IMAGE_VIEW,
  column: 'image_view',
  message: IMAGE_VIEW_MESSAGE,
});

export const isImageView = IMAGE_VIEW_CHOICE.is;

export const imageViewLabel = IMAGE_VIEW_CHOICE.label;

export const GALLERY_IMAGE_VIEW_CHOICES = IMAGE_VIEW_CHOICE.galleryChoices;

export const imageViewFromChoice = IMAGE_VIEW_CHOICE.fromChoice;

export const imageViewChoice = IMAGE_VIEW_CHOICE.choiceOf;

export const imageViewFor = IMAGE_VIEW_CHOICE.resolve;
