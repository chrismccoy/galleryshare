import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { fakeClock } from '../helpers/clock.js';
import { SETTING_KEYS } from '../../domain/settings.js';
import { limitOverrideKey } from '../../domain/limits.js';
import { createSettingsRepository } from '../../db/settings.repository.js';

test('settings round-trips booleans and strings', () => {
  const settings = createSettingsRepository(freshDb());
  const sharing = SETTING_KEYS.publicSharing;
  const override = limitOverrideKey('maxImageMb');
  const text = SETTING_KEYS.itemsPerPage;
  settings.set(sharing, true);
  settings.set(text, 'hello');
  settings.set(override, false);
  assert.equal(settings.get(sharing), true);
  assert.equal(settings.get(override), false);
  assert.equal(settings.get(text), 'hello');
  assert.equal(settings.get('missing'), null, 'a missing setting is null, like every other finder');
  settings.set(text, 'hi');
  assert.deepEqual(settings.all(), {
    [sharing]: true,
    [text]: 'hi',
    [override]: false,
  });
});

test('settings stamp times from the injected clock', () => {
  const db = freshDb();
  const at = '2026-03-04T05:06:07.000Z';
  const settings = createSettingsRepository(db, fakeClock(at));
  settings.set('override_items_per_page', true);
  assert.equal(
    db.prepare("SELECT updated_at FROM settings WHERE key = 'override_items_per_page'").get().updated_at,
    at,
  );
});
