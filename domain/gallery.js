import { randomBase62 } from '../lib/tokens.js';
import { FOLLOW_SITE } from './gallery-choice.js';

const GRID_TEXT_VALUES = Object.freeze({ [FOLLOW_SITE]: null, show: 1, hide: 0 });

export const GALLERY_DETAIL_LABELS = Object.freeze({
  title: 'title',
  description: 'description',
  allowZip: 'ZIP download',
  gridText: 'grid text',
  shareTheme: 'theme',
  imageView: 'image view',
});

export const GRID_TEXT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'show', label: 'Show' }),
  Object.freeze({ key: 'hide', label: 'Hide' }),
]);

export const GALLERY_GRID_TEXT_CHOICES = Object.freeze(Object.keys(GRID_TEXT_VALUES));

export const GRID_TEXT_MESSAGE = 'Choose how the gallery grid shows titles and captions.';

export function gridTextColumn(choice) {
  if (typeof choice !== 'string' || !Object.hasOwn(GRID_TEXT_VALUES, choice)) return undefined;
  return GRID_TEXT_VALUES[choice];
}

export function gridTextChoice(gallery) {
  if (gallery.grid_text == null) return FOLLOW_SITE;
  return gallery.grid_text === 1 ? 'show' : 'hide';
}

export function gridTextShown(gallery, siteShown) {
  if (gallery.grid_text == null) return siteShown;
  return gallery.grid_text === 1;
}

export const gridTextLabel = (shown) => (shown ? 'Shown' : 'Hidden');

export const DEFAULT_GALLERY_TITLE = 'Untitled gallery';

export const DEFAULT_IMAGE_TITLE = 'Title';

const PUBLIC_NAME_LENGTH = 10;

const nonBlank = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

export const galleryTitle = (row) => nonBlank(row?.title) ?? DEFAULT_GALLERY_TITLE;

export const imageTitle = (img) => nonBlank(img?.title);

export const DEFAULT_CAPTION_TEMPLATE = 'Image #{position}';

export const defaultCaption = (position) => DEFAULT_CAPTION_TEMPLATE.replace('{position}', String(position));

export const imageCaption = (img, position) => nonBlank(img?.caption) ?? defaultCaption(position);

export const isWritten = (img) => img.bytes_orig > 0 || img.bytes_web > 0 || img.bytes_thumb > 0;

export const editedByAdmin = (gallery) => gallery.updated_by != null && gallery.updated_by !== gallery.user_id;

export function newPublicName() {
  return randomBase62(PUBLIC_NAME_LENGTH);
}

export const zipOffered = (gallery, imageCount) => Boolean(gallery.allow_zip) && imageCount > 0;

export const zipEntryName = (img, position) => `${img.public_name}-${String(position).padStart(3, '0')}.${img.ext}`;
