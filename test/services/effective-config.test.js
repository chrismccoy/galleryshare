import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_KEYS } from '../../domain/settings.js';
import { freshDb } from '../helpers/db.js';
import { createSettingsRepository } from '../../db/settings.repository.js';
import { createEffectiveConfigService } from '../../services/effective-config.service.js';
import { testConfig, buildContext } from '../helpers/context.js';
import { limitOverrideKey, limitSettingKey } from '../../domain/limits.js';
import { ValidationError } from '../../lib/errors.js';

function setup(env = {}) {
  const settings = createSettingsRepository(freshDb());
  const effectiveConfig = createEffectiveConfigService({ settings, config: testConfig(env) });
  return { settings, effectiveConfig };
}

test('items per page: ITEMS_PER_PAGE unless the switch is on with a valid saved number', () => {
  const { settings, effectiveConfig } = setup({ ITEMS_PER_PAGE: '30' });
  assert.deepEqual(effectiveConfig.pageSize(), { value: 30, source: 'env' });
  settings.set(SETTING_KEYS.itemsPerPage, 60);
  assert.deepEqual(effectiveConfig.pageSize(), { value: 30, source: 'env' }, 'saved but switch off');
  settings.set(SETTING_KEYS.overrideItemsPerPage, true);
  assert.deepEqual(effectiveConfig.pageSize(), { value: 60, source: 'settings' });
  settings.set(SETTING_KEYS.itemsPerPage, 500);
  assert.deepEqual(effectiveConfig.pageSize(), { value: 30, source: 'env' }, 'an out-of-range stored value is ignored');
  assert.deepEqual(effectiveConfig.status().pageSize, { value: 30, source: 'env' });
});

test('share theme: SHARE_THEME unless its switch is on; then the saved theme', () => {
  const { settings, effectiveConfig } = setup({ SHARE_THEME: 'frame' });
  assert.deepEqual(effectiveConfig.shareTheme(), { value: 'frame', source: 'env' });
  settings.set(SETTING_KEYS.shareTheme, 'glass');
  assert.deepEqual(effectiveConfig.shareTheme(), { value: 'frame', source: 'env' }, 'saved but switch off');
  settings.set(SETTING_KEYS.overrideShareTheme, true);
  assert.deepEqual(effectiveConfig.shareTheme(), { value: 'glass', source: 'settings' });
  settings.set(SETTING_KEYS.shareTheme, 'gone');
  assert.deepEqual(effectiveConfig.status().shareTheme, { value: 'none', source: 'settings' }, 'an unknown saved key');
  assert.deepEqual(setup().effectiveConfig.shareTheme(), { value: 'none', source: 'env' }, 'none by default');
});

test('image view: SHARE_IMAGE_VIEW unless its switch is on; then the saved view', () => {
  const { settings, effectiveConfig } = setup({ SHARE_IMAGE_VIEW: 'new-tab' });
  assert.deepEqual(effectiveConfig.shareImageView(), { value: 'new-tab', source: 'env' });
  settings.set(SETTING_KEYS.shareImageView, 'page');
  assert.deepEqual(effectiveConfig.shareImageView(), { value: 'new-tab', source: 'env' }, 'saved but switch off');
  settings.set(SETTING_KEYS.overrideShareImageView, true);
  assert.deepEqual(effectiveConfig.shareImageView(), { value: 'page', source: 'settings' });
  assert.deepEqual(effectiveConfig.status().shareImageView, { value: 'page', source: 'settings' });
  assert.deepEqual(
    setup().effectiveConfig.shareImageView(),
    { value: 'lightbox', source: 'env' },
    'lightbox by default',
  );
});

test('grid text: SHARE_GRID_TEXT unless its switch is on; then the saved choice', () => {
  const { settings, effectiveConfig } = setup({ SHARE_GRID_TEXT: 'false' });
  assert.deepEqual(effectiveConfig.shareGridText(), { value: false, source: 'env' });
  settings.set(SETTING_KEYS.shareGridText, true);
  assert.deepEqual(effectiveConfig.shareGridText(), { value: false, source: 'env' }, 'saved but switch off');
  settings.set(SETTING_KEYS.overrideShareGridText, true);
  assert.deepEqual(effectiveConfig.shareGridText(), { value: true, source: 'settings' });
  settings.set(SETTING_KEYS.shareGridText, false);
  assert.deepEqual(effectiveConfig.status().shareGridText, { value: false, source: 'settings' });
  assert.deepEqual(setup().effectiveConfig.shareGridText(), { value: true, source: 'env' }, 'on by default');
});

test('status reads the settings once', () => {
  let allCalls = 0;
  const effectiveConfig = createEffectiveConfigService({
    settings: {
      all: () => {
        allCalls += 1;
        return {};
      },
    },
    config: testConfig({ ITEMS_PER_PAGE: '25' }),
  });
  assert.deepEqual(effectiveConfig.status().pageSize, { value: 25, source: 'env' });
  assert.equal(allCalls, 1);
});

test('a saved limit wins only while its switch is on, without restart', () => {
  const { context } = buildContext();
  const effectiveConfig = context.effectiveConfigService;
  context.settingsService.save({ switches: {}, limits: { maxImageMb: '50' } }, null);
  assert.deepEqual(effectiveConfig.limits().maxImageMb, { value: 25, source: 'env' });
  context.settings.set(limitOverrideKey('maxImageMb'), true);
  assert.deepEqual(effectiveConfig.limits().maxImageMb, { value: 50, source: 'settings' });
  assert.equal(effectiveConfig.limitValues().maxImageMb, 50);
  assert.equal(effectiveConfig.limitValues().maxZipUploadMb, 500);
  context.settings.set(limitSettingKey('maxImageMb'), 9999);
  assert.deepEqual(
    effectiveConfig.limits().maxImageMb,
    { value: 25, source: 'env' },
    'out-of-range stored value ignored',
  );
});

test('saving an out-of-range limit is a validation error', () => {
  const { context } = buildContext();
  assert.throws(
    () => context.settingsService.save({ switches: {}, limits: { maxImagesPerGallery: '0' } }, null),
    ValidationError,
  );
  assert.equal(context.settings.get(limitSettingKey('maxImagesPerGallery')), null);
});
