import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrsOf, elementByAttr, startApp, tagsWith, textOf } from '../helpers/http.js';
import { OVERRIDE_SWITCHES } from '../../domain/settings.js';
import { LIMITS, limitOverrideKey, limitSettingKey } from '../../domain/limits.js';
import { SETTING_KEYS } from '../../domain/settings.js';
import { PATHS } from '../../config/urls.js';

const SETTINGS = PATHS.admin.settings;

async function startWithAdmin(t, env = {}) {
  const app = await startApp(env);
  t.after(() => app.close());
  return { app, admin: await app.signedIn({ role: 'admin' }) };
}

const itemsPerPageInEffect = (html) => textOf(elementByAttr(html, 'data-items-per-page'));

const limitInEffect = (html, name) => textOf(elementByAttr(html, 'data-limit', name));

test('non-admin gets 404', async (t) => {
  const { app } = await startWithAdmin(t);
  const s = await app.signedIn();
  assert.equal((await app.get(s, SETTINGS)).res.status, 404);
  assert.equal((await app.post(s, SETTINGS)).res.status, 404);
});

test('page renders no-store with the switches and the items-per-page status', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const { res, html } = await app.get(admin, SETTINGS);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(html, /autocomplete="off"/);
  for (const n of OVERRIDE_SWITCHES.map((sw) => sw.name)) {
    assert.ok(html.includes(`name="${n}"`), n);
  }
  assert.equal(itemsPerPageInEffect(html), '25 (.env)');
  assert.ok(html.includes('Use custom max ZIP upload (MB)'));
  assert.doesNotMatch(html, /\(mb\b/);
});

test('the save bar: pinned and hidden until a change, it saves the settings form; no-JS keeps its own button', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const { html } = await app.get(admin, SETTINGS);
  assert.equal(attrsOf(html, 'id', 'settings-form').tag, 'form');
  const bar = attrsOf(html, 'data-save-bar');
  assert.equal(bar['data-save-bar'], 'settings-form');
  assert.ok('hidden' in bar, 'hidden until a change');
  const saveButtons = tagsWith(html, 'form', 'settings-form');
  assert.equal(saveButtons.length, 1);
  assert.equal(saveButtons[0].attrs.type, 'submit');
  assert.match(textOf(elementByAttr(html, 'data-save-bar')), /Discard\s+Save settings/);
  assert.ok(elementByAttr(html, 'data-leave-dialog'), 'the leave dialog');
  assert.equal(attrsOf(html, 'src', '/js/save-bar.js')?.tag, 'script');
  assert.match(html, /<noscript><button type="submit" class="btn btn-primary">Save settings<\/button><\/noscript>/);
});

test('saving a switch and a page size succeeds with a 303 notice', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const r = await app.post(admin, SETTINGS, { override_items_per_page: 'on', items_per_page: '40' });
  assert.equal(r.res.status, 303);
  assert.match(r.res.headers.get('location'), /^\/admin\/settings\?notice=saved$/);
  assert.equal(app.context.settings.get(SETTING_KEYS.overrideItemsPerPage), true);
  assert.equal(app.context.settings.get(SETTING_KEYS.itemsPerPage), 40);
  const page = await app.get(admin, `${SETTINGS}?notice=saved`);
  assert.match(page.html, /Settings saved/);
  assert.equal(itemsPerPageInEffect(page.html), '40 (Settings)');
});

test('fields with nothing saved show the .env value; sent back unchanged with the switch off, it is not stored', async (t) => {
  const { app, admin } = await startWithAdmin(t, { MAX_IMAGE_MB: '30', ITEMS_PER_PAGE: '20' });
  const { html } = await app.get(admin, SETTINGS);
  assert.equal(attrsOf(html, 'id', 'items_per_page').value, '20');
  assert.equal(attrsOf(html, 'id', limitSettingKey('maxImageMb')).value, '30');

  const shown = await app.post(admin, SETTINGS, { items_per_page: '20', [limitSettingKey('maxImageMb')]: '30' });
  assert.equal(shown.res.status, 303);
  assert.equal(app.context.settings.get(SETTING_KEYS.itemsPerPage), null);
  assert.equal(app.context.settings.get(limitSettingKey('maxImageMb')), null);

  await app.post(admin, SETTINGS, { items_per_page: '15', [limitSettingKey('maxImageMb')]: '30' });
  assert.equal(app.context.settings.get(SETTING_KEYS.itemsPerPage), 15);
  assert.equal(app.context.settings.get(limitSettingKey('maxImageMb')), null);
  await app.post(admin, SETTINGS, {
    items_per_page: '15',
    [limitOverrideKey('maxImageMb')]: 'on',
    [limitSettingKey('maxImageMb')]: '30',
  });
  assert.equal(app.context.settings.get(limitSettingKey('maxImageMb')), 30);
  assert.deepEqual(app.context.effectiveConfigService.limits().maxImageMb, { value: 30, source: 'settings' });
  const after = await app.get(admin, SETTINGS);
  assert.equal(attrsOf(after.html, 'id', 'items_per_page').value, '15', 'a saved value shows over .env');
});

test('an out-of-range page size is 400 and nothing is saved', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const r = await app.post(admin, SETTINGS, { override_items_per_page: 'on', items_per_page: '3' });
  assert.equal(r.res.status, 400);
  assert.equal(r.res.headers.get('cache-control'), 'no-store');
  assert.match(r.html, /Enter a number from 5 to 100\./);
  assert.equal(app.context.settings.get(SETTING_KEYS.overrideItemsPerPage), null);
});

function sharingChecked(html) {
  const input = attrsOf(html, 'name', 'public_sharing');
  assert.equal(input?.tag, 'input', 'public_sharing switch rendered');
  return 'checked' in input;
}

test('public share links switch is checked by default, unchecked after saving it off; each save sets every switch it sends', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const first = await app.get(admin, SETTINGS);
  assert.ok(first.html.includes('Public share links'));
  assert.ok(first.html.includes('Turn off to make every share link stop working.'));
  assert.equal(sharingChecked(first.html), true);

  let r = await app.post(admin, SETTINGS, { override_items_per_page: 'on', items_per_page: '25' });
  assert.equal(r.res.status, 303);
  assert.equal(app.context.settings.get(SETTING_KEYS.publicSharing), false);
  assert.equal(app.context.settings.get(SETTING_KEYS.overrideItemsPerPage), true);
  assert.equal(sharingChecked((await app.get(admin, SETTINGS)).html), false);

  r = await app.post(admin, SETTINGS, { public_sharing: 'on' });
  assert.equal(r.res.status, 303);
  assert.equal(app.context.settings.get(SETTING_KEYS.publicSharing), true);
  assert.equal(app.context.settings.get(SETTING_KEYS.overrideItemsPerPage), false);
  assert.equal(sharingChecked((await app.get(admin, SETTINGS)).html), true);
});

test('grid text: the switch is on by default, saves off, and "In effect now" follows the override', async (t) => {
  const { app, admin } = await startWithAdmin(t, { SHARE_GRID_TEXT: 'false' });
  const first = await app.get(admin, SETTINGS);
  assert.ok(first.html.includes('Titles and captions on the gallery grid'));
  assert.ok('checked' in attrsOf(first.html, 'name', 'share_grid_text'), 'on when never saved');
  assert.equal(textOf(elementByAttr(first.html, 'data-share-grid-text')), 'Hidden (.env)');

  let r = await app.post(admin, SETTINGS, {
    public_sharing: 'on',
    override_share_grid_text: 'on',
    share_grid_text: 'on',
  });
  assert.equal(r.res.status, 303);
  assert.equal(app.context.settings.get(SETTING_KEYS.shareGridText), true);
  assert.equal(
    textOf(elementByAttr((await app.get(admin, SETTINGS)).html, 'data-share-grid-text')),
    'Shown (Settings)',
  );

  r = await app.post(admin, SETTINGS, { public_sharing: 'on', override_share_grid_text: 'on' });
  assert.equal(r.res.status, 303);
  const after = (await app.get(admin, SETTINGS)).html;
  assert.equal(app.context.settings.get(SETTING_KEYS.shareGridText), false);
  assert.ok(!('checked' in attrsOf(after, 'name', 'share_grid_text')));
  assert.equal(textOf(elementByAttr(after, 'data-share-grid-text')), 'Hidden (Settings)');
});

test('share theme: a button select of every theme, saved with its switch, and "In effect now" follows it', async (t) => {
  const { app, admin } = await startWithAdmin(t, { SHARE_THEME: 'frame' });
  const first = await app.get(admin, SETTINGS);
  const buttons = tagsWith(first.html, 'name', 'share_theme');
  assert.deepEqual(
    buttons.map((tag) => [tag.attrs.type, tag.attrs.value]),
    [
      ['radio', 'none'],
      ['radio', 'frame'],
      ['radio', 'dark-wall'],
      ['radio', 'app-window'],
      ['radio', 'polaroid'],
      ['radio', 'glass'],
      ['radio', 'paper-stack'],
    ],
  );
  assert.equal(attrsOf(first.html, 'value', 'none').checked, '', 'nothing saved: None is checked');
  assert.equal(textOf(elementByAttr(first.html, 'data-share-theme')), 'Frame (.env)');
  assert.ok(first.html.includes('name="override_share_theme"'));

  let r = await app.post(admin, SETTINGS, { public_sharing: 'on', override_share_theme: 'on', share_theme: 'glass' });
  assert.equal(r.res.status, 303);
  assert.equal(app.context.settings.get(SETTING_KEYS.shareTheme), 'glass');
  const after = (await app.get(admin, SETTINGS)).html;
  assert.equal(textOf(elementByAttr(after, 'data-share-theme')), 'Glass (Settings)');
  assert.ok('checked' in attrsOf(after, 'value', 'glass'));

  r = await app.post(admin, SETTINGS, { public_sharing: 'on', override_share_theme: 'on', share_theme: 'neon' });
  assert.equal(r.res.status, 400);
  assert.match(r.html, /Choose a share theme/);
  assert.equal(app.context.settings.get(SETTING_KEYS.shareTheme), 'glass', 'nothing saved');
});

test('image view: a button select of the three views, saved with its switch, and "In effect now" follows it', async (t) => {
  const { app, admin } = await startWithAdmin(t, { SHARE_IMAGE_VIEW: 'new-tab' });
  const first = await app.get(admin, SETTINGS);
  assert.deepEqual(
    tagsWith(first.html, 'name', 'share_image_view').map((tag) => tag.attrs.value),
    ['lightbox', 'new-tab', 'page'],
  );
  assert.equal(textOf(elementByAttr(first.html, 'data-share-image-view')), 'New tab (.env)');
  const r = await app.post(admin, SETTINGS, {
    public_sharing: 'on',
    override_share_image_view: 'on',
    share_image_view: 'page',
  });
  assert.equal(r.res.status, 303);
  assert.equal(
    textOf(elementByAttr((await app.get(admin, SETTINGS)).html, 'data-share-image-view')),
    'Image page (Settings)',
  );
  const bad = await app.post(admin, SETTINGS, { public_sharing: 'on', share_image_view: 'popup' });
  assert.equal(bad.res.status, 400);
  assert.match(bad.html, /Choose an image view/);
});

test('Settings page shows each limit with its source in "In effect now"', async (t) => {
  const { app, admin } = await startWithAdmin(t, { MAX_IMAGE_MB: '30' });
  const { html } = await app.get(admin, SETTINGS);
  for (const def of Object.values(LIMITS)) assert.ok(html.includes(def.label), def.label);
  assert.equal(limitInEffect(html, 'maxImageMb'), '30 (.env)');
  assert.equal(limitInEffect(html, 'maxZipUploadMb'), '500 (.env)');
  for (const name of Object.keys(LIMITS)) assert.ok(html.includes(`name="${limitOverrideKey(name)}"`), name);
});

test('POST saving a limit and turning its switch on changes the next upload limit', async (t) => {
  const { app, admin } = await startWithAdmin(t);
  const r = await app.post(admin, SETTINGS, {
    [limitOverrideKey('maxImageMb')]: 'on',
    [limitSettingKey('maxImageMb')]: '40',
  });
  assert.equal(r.res.status, 303);
  assert.deepEqual(app.context.effectiveConfigService.limits().maxImageMb, { value: 40, source: 'settings' });
  assert.equal(limitInEffect((await app.get(admin, SETTINGS)).html, 'maxImageMb'), '40 (Settings)');
  const bad = await app.post(admin, SETTINGS, { [limitSettingKey('maxImageMb')]: '9999' });
  assert.equal(bad.res.status, 400);
  assert.match(bad.html, /Enter a number from 1 to 200\./);
  assert.equal(app.context.effectiveConfigService.limitValues().maxImageMb, 40);
});

test('items per page: the field, the switch and the .env size; a bad number answers 400 and keeps what was typed', async (t) => {
  const { app, admin } = await startWithAdmin(t, { ITEMS_PER_PAGE: '30' });
  let r = await app.get(admin, SETTINGS);
  assert.equal(attrsOf(r.html, 'name', 'items_per_page')?.tag, 'input');
  assert.equal(attrsOf(r.html, 'name', 'override_items_per_page')?.tag, 'input');
  assert.equal(itemsPerPageInEffect(r.html), '30 (.env)');

  r = await app.post(admin, SETTINGS, { public_sharing: 'on', override_items_per_page: 'on', items_per_page: '500' });
  assert.equal(r.res.status, 400);
  assert.match(r.html, /Enter a number from 5 to 100\./);
  assert.equal(attrsOf(r.html, 'name', 'items_per_page').value, '500', 'the form keeps what was typed');
  assert.equal(app.context.settingsService.current().itemsPerPage, null);

  await app.post(admin, SETTINGS, { public_sharing: 'on', override_items_per_page: 'on', items_per_page: '40' });
  r = await app.get(admin, SETTINGS);
  assert.equal(itemsPerPageInEffect(r.html), '40 (Settings)');
});
