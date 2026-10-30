import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, USER, ROLES, ROLE_LABELS, isAdmin, isRole, mayManageOwnedBy } from '../../domain/roles.js';
import {
  ITEMS_PER_PAGE_MESSAGE,
  OVERRIDE_SWITCHES,
  SETTING_KEYS,
  publicSharingOn,
  storedItemsPerPage,
  storedShareGridText,
  storedShareImageView,
  storedShareTheme,
} from '../../domain/settings.js';
import {
  LIMITS,
  TUNABLES,
  envTunable,
  imageCountMessage,
  isTunableValue,
  storedTunable,
  tunableMessage,
} from '../../domain/limits.js';

test('roles: the two roles, isRole and isAdmin', () => {
  assert.deepEqual(ROLES, [USER, ADMIN]);
  assert.ok(isRole('user') && isRole('admin'));
  for (const bad of ['root', '', null, undefined, 'Admin']) assert.equal(isRole(bad), false, String(bad));
  assert.equal(isAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ role: 'user' }), false);
  assert.equal(isAdmin(null), false);
});

test('mayManageOwnedBy: the owner or any admin; nobody without a user', () => {
  assert.equal(mayManageOwnedBy({ id: 1, role: USER }, 1), true, 'owner');
  assert.equal(mayManageOwnedBy({ id: 2, role: USER }, 1), false, 'another user');
  assert.equal(mayManageOwnedBy({ id: 2, role: ADMIN }, 1), true, 'admin');
  assert.equal(mayManageOwnedBy(null, 1), false);
  assert.equal(mayManageOwnedBy(undefined, 1), false);
});

test('the override switches are items per page, one per upload limit, then the grid text, the share theme and the image view', () => {
  assert.deepEqual(
    OVERRIDE_SWITCHES.map((s) => [s.name, s.title]),
    [
      ['override_items_per_page', 'Use custom items per page'],
      ['override_limit_maxImageMb', 'Use custom max image size (MB)'],
      ['override_limit_maxZipUploadMb', 'Use custom max ZIP upload (MB)'],
      ['override_limit_maxImagesPerGallery', 'Use custom max images per gallery'],
      ['override_limit_userQuotaMb', 'Use custom storage per user (MB, 0 = unlimited)'],
      ['override_limit_maxUploadBatchMb', 'Use custom max upload batch (MB)'],
      ['override_share_grid_text', 'Use custom grid text setting'],
      ['override_share_theme', 'Use custom share theme'],
      ['override_share_image_view', 'Use custom image view'],
    ],
  );
  assert.equal(
    OVERRIDE_SWITCHES.at(-3).help,
    'Use the "Titles and captions on the gallery grid" switch below instead of SHARE_GRID_TEXT from .env.',
  );
  assert.equal(OVERRIDE_SWITCHES.at(-2).help, 'Use the "Share theme" chosen below instead of SHARE_THEME from .env.');
  assert.equal(
    OVERRIDE_SWITCHES.at(-1).help,
    'Use the "Image view" chosen below instead of SHARE_IMAGE_VIEW from .env.',
  );
});

test('the saved share theme is a known theme key, else the default theme', () => {
  assert.equal(SETTING_KEYS.shareTheme, 'share_theme');
  assert.equal(SETTING_KEYS.overrideShareTheme, 'override_share_theme');
  assert.equal(storedShareTheme({}), 'none');
  assert.equal(storedShareTheme({ share_theme: 'glass' }), 'glass');
  assert.equal(storedShareTheme({ share_theme: 'neon' }), 'none');
  assert.equal(storedShareTheme({ share_theme: 1 }), 'none');
});

test('the saved image view is a known view key, else the lightbox', () => {
  assert.equal(SETTING_KEYS.shareImageView, 'share_image_view');
  assert.equal(SETTING_KEYS.overrideShareImageView, 'override_share_image_view');
  assert.equal(storedShareImageView({}), 'lightbox');
  assert.equal(storedShareImageView({ share_image_view: 'page' }), 'page');
  assert.equal(storedShareImageView({ share_image_view: 'popup' }), 'lightbox');
});

test('the saved grid text setting is on unless saved as false', () => {
  assert.equal(SETTING_KEYS.shareGridText, 'share_grid_text');
  assert.equal(SETTING_KEYS.overrideShareGridText, 'override_share_grid_text');
  assert.equal(storedShareGridText({}), true);
  assert.equal(storedShareGridText({ share_grid_text: true }), true);
  assert.equal(storedShareGridText({ share_grid_text: false }), false);
});

test('every role has a label', () => {
  assert.deepEqual(
    ROLES.map((role) => ROLE_LABELS[role]),
    ['User', 'Admin'],
  );
});

test('the stored-setting readers keep only values that still count', () => {
  assert.equal(storedItemsPerPage({ items_per_page: 40 }), 40);
  assert.equal(storedItemsPerPage({ items_per_page: 4 }), null);
  assert.equal(storedItemsPerPage({}), null);
  assert.equal(publicSharingOn({}), true);
  assert.equal(publicSharingOn({ public_sharing: true }), true);
  assert.equal(publicSharingOn({ public_sharing: false }), false);
});

test('TUNABLES is items per page then every limit, each with its stored keys', () => {
  assert.deepEqual(Object.keys(TUNABLES), ['itemsPerPage', ...Object.keys(LIMITS)]);
  assert.deepEqual(
    Object.values(TUNABLES).map((def) => [def.settingKey, def.overrideKey]),
    [
      ['items_per_page', 'override_items_per_page'],
      ['limit_maxImageMb', 'override_limit_maxImageMb'],
      ['limit_maxZipUploadMb', 'override_limit_maxZipUploadMb'],
      ['limit_maxImagesPerGallery', 'override_limit_maxImagesPerGallery'],
      ['limit_userQuotaMb', 'override_limit_userQuotaMb'],
      ['limit_maxUploadBatchMb', 'override_limit_maxUploadBatchMb'],
    ],
  );
  assert.equal(SETTING_KEYS.itemsPerPage, TUNABLES.itemsPerPage.settingKey);
  assert.deepEqual(
    OVERRIDE_SWITCHES.map((s) => s.name),
    [
      ...Object.values(TUNABLES).map((def) => def.overrideKey),
      SETTING_KEYS.overrideShareGridText,
      SETTING_KEYS.overrideShareTheme,
      SETTING_KEYS.overrideShareImageView,
    ],
  );
  assert.equal(OVERRIDE_SWITCHES[0].help, 'Use the number saved below instead of ITEMS_PER_PAGE from .env.');
});

test('one validator, message and stored reader serve items per page and the limits', () => {
  assert.equal(ITEMS_PER_PAGE_MESSAGE, 'Enter a number from 5 to 100.');
  assert.equal(tunableMessage('itemsPerPage'), ITEMS_PER_PAGE_MESSAGE);
  assert.equal(tunableMessage('maxImageMb'), 'Enter a number from 1 to 200.');
  assert.equal(isTunableValue('itemsPerPage', 100), true);
  assert.equal(isTunableValue('itemsPerPage', 101), false);
  assert.equal(isTunableValue('toString', 1), false, 'inherited names are not tunables');
  assert.equal(isTunableValue('maxImageMb', 25), true);
  assert.equal(storedTunable({ items_per_page: 40 }, 'itemsPerPage'), 40);
  assert.equal(storedTunable({ limit_maxImageMb: 40 }, 'maxImageMb'), 40);
  assert.equal(storedTunable({ limit_maxImageMb: 9999 }, 'maxImageMb'), null);
  assert.equal(storedTunable({}, 'maxImageMb'), null);
});

test('envTunable reads page size and each limit from where the configuration keeps them', () => {
  const env = { itemsPerPage: 30, limits: { maxImageMb: 40 } };
  assert.equal(envTunable(env, 'itemsPerPage'), 30);
  assert.equal(envTunable(env, 'maxImageMb'), 40);
  assert.equal(envTunable(env, 'maxBatchMb'), undefined);
  assert.equal(envTunable({}, 'maxImageMb'), undefined);
});

test('imageCountMessage words the refusal for an existing or a new gallery, exact or "more than"', () => {
  assert.equal(
    imageCountMessage({ existing: true, have: 498, max: 500, adds: 3 }),
    'This gallery has 498 images and can hold 500; this upload adds 3.',
  );
  assert.equal(
    imageCountMessage({ existing: true, have: 498, max: 500, adds: 2, moreThan: true }),
    'This gallery has 498 images and can hold 500; this upload adds more than 2.',
  );
  assert.equal(
    imageCountMessage({ existing: false, have: 0, max: 500, adds: 500, moreThan: true }),
    'This upload has more than 500 images; a gallery can hold 500.',
  );
  assert.equal(
    imageCountMessage({ existing: false, have: 0, max: 5, adds: 7 }),
    'This upload has 7 images; a gallery can hold 5.',
  );
});
