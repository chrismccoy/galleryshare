import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { createTransactionRunner } from '../../db/database.js';
import { createSettingsRepository } from '../../db/settings.repository.js';
import { createSettingsService } from '../../services/settings.service.js';
import { OVERRIDE_SWITCHES, SETTING_KEYS } from '../../domain/settings.js';
import { ValidationError } from '../../lib/errors.js';
import { insertBareUser } from '../helpers/accounts.js';
import { isPublicError } from '../helpers/assertions.js';

function setup() {
  const db = freshDb();
  const settings = createSettingsRepository(db);
  return { service: createSettingsService({ runInTransaction: createTransactionRunner(db), settings }), settings };
}

const OFF = Object.fromEntries(OVERRIDE_SWITCHES.map((s) => [s.name, false]));

test('a fresh database has every switch off and sharing on', () => {
  const { service } = setup();
  assert.deepEqual(service.current(), {
    switches: OFF,
    publicSharing: true,
    shareGridText: true,
    shareTheme: 'none',
    shareImageView: 'lightbox',
    itemsPerPage: null,
    limits: {
      maxImageMb: null,
      maxZipUploadMb: null,
      maxImagesPerGallery: null,
      userQuotaMb: null,
      maxUploadBatchMb: null,
    },
  });
});

test('public sharing is on when never saved, and follows saves', () => {
  const { service, settings } = setup();
  assert.equal(service.current().publicSharing, true);
  assert.equal(service.publicSharingOn(), true);
  service.save({ switches: OFF, publicSharing: false }, null);
  assert.equal(service.current().publicSharing, false);
  assert.equal(service.publicSharingOn(), false);
  assert.equal(settings.all()[SETTING_KEYS.publicSharing], false);
  service.save({ switches: OFF, publicSharing: true }, null);
  assert.equal(service.current().publicSharing, true);
  assert.equal(service.publicSharingOn(), true);
});

test('saving without publicSharing keeps the stored value', () => {
  const { service } = setup();
  service.save({ switches: OFF }, null);
  assert.equal(service.publicSharingOn(), true, 'never saved: stays on');
  service.save({ switches: OFF, publicSharing: false }, null);
  service.save({ switches: OFF }, null);
  assert.equal(service.publicSharingOn(), false, 'saved off: stays off');
  service.save({ switches: OFF, publicSharing: true }, null);
  service.save({ switches: OFF }, null);
  assert.equal(service.publicSharingOn(), true, 'saved on: stays on');
});

test('grid text: on when never saved, saved with the form, kept when the form leaves it out', () => {
  const { service, settings } = setup();
  assert.equal(service.current().shareGridText, true);
  service.save({ switches: OFF, shareGridText: false }, null);
  assert.equal(service.current().shareGridText, false);
  assert.equal(settings.all()[SETTING_KEYS.shareGridText], false);
  service.save({ switches: OFF }, null);
  assert.equal(service.current().shareGridText, false, 'left out: kept');
  service.save({ switches: { ...OFF, override_share_grid_text: true }, shareGridText: true }, null);
  assert.equal(service.current().shareGridText, true);
  assert.equal(service.current().switches.override_share_grid_text, true);
});

test('public sharing is not an override switch and leaves them untouched', () => {
  const { service } = setup();
  assert.ok(!OVERRIDE_SWITCHES.some((s) => s.name === SETTING_KEYS.publicSharing));
  const switches = { ...OFF, override_items_per_page: true };
  service.save({ switches, itemsPerPage: '20', publicSharing: false }, null);
  assert.deepEqual(service.current().switches, switches);
});

test('items per page: saved as a whole number from 5 to 100; blank keeps nothing; out of range is refused', () => {
  const { service, settings } = setup();
  assert.equal(service.current().itemsPerPage, null);
  service.save({ switches: OFF, itemsPerPage: ' 40 ' }, null);
  assert.equal(service.current().itemsPerPage, 40);
  service.save({ switches: OFF, itemsPerPage: '' }, null);
  assert.equal(service.current().itemsPerPage, 40, 'a blank field keeps the stored number');
  for (const bad of ['4', '101', '2.5', 'ten', '-5']) {
    assert.throws(
      () => service.save({ switches: OFF, itemsPerPage: bad }, null),
      isPublicError(ValidationError, 'Enter a number from 5 to 100.'),
      bad,
    );
  }
  assert.equal(settings.get('items_per_page'), 40, 'refused saves write nothing');
});

test('turning the items-per-page switch on needs a number, typed now or saved before', () => {
  const { service, settings } = setup();
  const on = { ...OFF, override_items_per_page: true };
  assert.throws(() => service.save({ switches: on, itemsPerPage: '' }, null), /Enter a number from 5 to 100\./);
  assert.equal(settings.get('override_items_per_page'), null, 'nothing written');
  service.save({ switches: on, itemsPerPage: '15' }, null);
  service.save({ switches: on, itemsPerPage: '' }, null);
  assert.equal(service.current().itemsPerPage, 15);
  assert.equal(settings.get('override_items_per_page'), true);
});

test('activity: publicSharingChanged is recorded only when the value changes', () => {
  const db = freshDb();
  const events = [];
  const service = createSettingsService({
    runInTransaction: createTransactionRunner(db),
    settings: createSettingsRepository(db),
    activityService: {
      record: (e) => events.push(e),
    },
  });
  service.save({ switches: OFF, publicSharing: true }, null);
  assert.deepEqual(events, [], 'unchanged');
  service.save({ switches: OFF, publicSharing: false }, null);
  service.save({ switches: OFF, publicSharing: false }, null);
  service.save({ switches: OFF }, null);
  service.save({ switches: OFF, publicSharing: true }, null);
  assert.deepEqual(
    events.map((e) => [e.kind, e.details, e.actor]),
    [
      ['publicSharingChanged', 'off', null],
      ['publicSharingChanged', 'on', null],
    ],
  );
});

function setupRecording(envValues = { itemsPerPage: 20, limits: { maxImageMb: 25 } }) {
  const db = freshDb();
  const events = [];
  const service = createSettingsService({
    runInTransaction: createTransactionRunner(db),
    settings: createSettingsRepository(db),
    activityService: {
      record: (e) => events.push(e),
    },
    envValues,
  });
  return { service, events, admin: insertBareUser(db, { email: 'a@example.com', role: 'admin' }) };
}

test('activity: settingChanged is recorded once per changed value, with before and after', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: { ...OFF, override_limit_maxImageMb: true }, limits: { maxImageMb: '40' } }, admin);
  assert.deepEqual(
    events.map((e) => [e.kind, e.actor, e.details]),
    [
      ['settingChanged', admin, 'Use custom max image size (MB): off → on'],
      ['settingChanged', admin, 'Max image size (MB): 25 (.env) → 40'],
    ],
  );
  events.length = 0;
  service.save({ switches: { ...OFF, override_limit_maxImageMb: true }, limits: { maxImageMb: '25' } }, admin);
  assert.deepEqual(
    events.map((e) => e.details),
    ['Max image size (MB): 40 → 25'],
  );
});

test('activity: settingChanged covers grid text and items per page, and skips public sharing', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: OFF, publicSharing: false, shareGridText: false, itemsPerPage: '30' }, admin);
  assert.deepEqual(
    events.map((e) => [e.kind, e.details]),
    [
      ['publicSharingChanged', 'off'],
      ['settingChanged', 'Titles and captions on the gallery grid: on → off'],
      ['settingChanged', 'Items per page: 20 (.env) → 30'],
    ],
  );
});

test('activity: saving unchanged settings records nothing; a null actor is passed on (record() stores it as system)', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: OFF, limits: { maxImageMb: '40' } }, admin);
  events.length = 0;
  service.save({ switches: OFF, limits: { maxImageMb: '40' } }, admin);
  service.save({ switches: OFF, limits: { maxImageMb: '' } }, admin);
  assert.deepEqual(events, []);
  service.save({ switches: OFF, limits: { maxImageMb: '40' } }, admin);
  assert.deepEqual(events, []);
  service.save({ switches: OFF, limits: { maxImageMb: '50' } }, null);
  assert.deepEqual(
    events.map((e) => [e.actor, e.details]),
    [[null, 'Max image size (MB): 40 → 50']],
  );
});

test('activity: an unset value is named by its .env value, or as .env when that is unknown', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: OFF, limits: { maxImageMb: '40' } }, admin);
  assert.deepEqual(
    events.map((e) => e.details),
    ['Max image size (MB): 25 (.env) → 40'],
  );
  const bare = setupRecording({});
  bare.service.save({ switches: OFF, itemsPerPage: '30' }, bare.admin);
  assert.deepEqual(
    bare.events.map((e) => e.details),
    ['Items per page: .env → 30'],
  );
});

test('activity: a share theme change is recorded by its labels; an unknown theme saves nothing', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: { ...OFF, override_share_theme: true }, shareTheme: 'polaroid' }, admin);
  assert.deepEqual(
    events.map((e) => e.details),
    ['Use custom share theme: off → on', 'Share theme: None → Polaroid'],
  );
  assert.equal(service.current().shareTheme, 'polaroid');
  events.length = 0;
  assert.throws(
    () => service.save({ switches: { ...OFF, override_share_theme: true }, shareTheme: 'neon' }, admin),
    /Choose a share theme/,
  );
  assert.deepEqual(events, []);
  assert.equal(service.current().shareTheme, 'polaroid');
  service.save({ switches: { ...OFF, override_share_theme: true } }, admin);
  assert.equal(service.current().shareTheme, 'polaroid', 'kept when the form sends no theme');
});

test('activity: an image view change is recorded by its labels; an unknown view saves nothing', () => {
  const { service, events, admin } = setupRecording();
  service.save({ switches: { ...OFF, override_share_image_view: true }, shareImageView: 'page' }, admin);
  assert.deepEqual(
    events.map((e) => e.details),
    ['Use custom image view: off → on', 'Image view: Lightbox → Image page'],
  );
  events.length = 0;
  assert.throws(() => service.save({ switches: OFF, shareImageView: 'popup' }, admin), /Choose an image view/);
  assert.deepEqual(events, []);
  assert.equal(service.current().shareImageView, 'page');
});
