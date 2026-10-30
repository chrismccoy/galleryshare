import { deepFreeze } from '../lib/deep-freeze.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '../lib/paging.js';

export const MIN_PASSWORD_LENGTH = 10;

export const MAX_DISPLAY_NAME = 80;

export const INVITE_DAYS = 7;

export const MAX_INVITE_LABEL = 80;

export const RESET_HOURS = 24;

export const MAX_TITLE = 200;

export const MAX_DESCRIPTION = 2000;

export const MAX_CAPTION = 1000;

export const GALLERY_FIELD_MAX = Object.freeze({
  title: MAX_TITLE,
  description: MAX_DESCRIPTION,
  caption: MAX_CAPTION,
});


export const LIMITS = deepFreeze({
  maxImageMb: { env: 'MAX_IMAGE_MB', defaultValue: 25, min: 1, max: 200, label: 'Max image size (MB)' },
  maxZipUploadMb: { env: 'MAX_ZIP_UPLOAD_MB', defaultValue: 500, min: 1, max: 5000, label: 'Max ZIP upload (MB)' },
  maxImagesPerGallery: {
    env: 'MAX_IMAGES_PER_GALLERY',
    defaultValue: 500,
    min: 1,
    max: 5000,
    label: 'Max images per gallery',
  },
  userQuotaMb: {
    env: 'USER_QUOTA_MB',
    defaultValue: 0,
    min: 0,
    max: 10_000_000,
    label: 'Storage per user (MB, 0 = unlimited)',
  },
  maxUploadBatchMb: {
    env: 'MAX_UPLOAD_BATCH_MB',
    defaultValue: 1000,
    min: 1,
    max: 10_000,
    label: 'Max upload batch (MB)',
  },
});

export const limitSettingKey = (name) => `limit_${name}`;

export const limitOverrideKey = (name) => `override_limit_${name}`;


export const TUNABLES = deepFreeze({
  itemsPerPage: {
    env: 'ITEMS_PER_PAGE',
    defaultValue: DEFAULT_PAGE_SIZE,
    min: MIN_PAGE_SIZE,
    max: MAX_PAGE_SIZE,
    label: 'Items per page',
    settingKey: 'items_per_page',
    overrideKey: 'override_items_per_page',
  },
  ...Object.fromEntries(
    Object.entries(LIMITS).map(([name, def]) => [
      name,
      { ...def, settingKey: limitSettingKey(name), overrideKey: limitOverrideKey(name) },
    ]),
  ),
});

export function isTunableValue(name, value) {
  const def = Object.hasOwn(TUNABLES, name) ? TUNABLES[name] : null;
  return Boolean(def) && Number.isInteger(value) && value >= def.min && value <= def.max;
}

export const tunableMessage = (name) => `Enter a number from ${TUNABLES[name].min} to ${TUNABLES[name].max}.`;

export function storedTunable(values, name) {
  const saved = values[TUNABLES[name].settingKey];
  return isTunableValue(name, saved) ? saved : null;
}

export const envTunable = (env, name) => (name === 'itemsPerPage' ? env.itemsPerPage : env.limits?.[name]);

export function imageCountMessage({ existing, have, max, adds, moreThan = false }) {
  const amount = moreThan ? `more than ${adds}` : String(adds);
  return existing
    ? `This gallery has ${have} images and can hold ${max}; this upload adds ${amount}.`
    : `This upload has ${amount} images; a gallery can hold ${max}.`;
}

export const uploadSizeMessage = (mb, maxMb) => `This upload is ${mb} MB; uploads are limited to ${maxMb} MB.`;
