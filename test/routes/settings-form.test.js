import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERRIDE_SWITCHES } from '../../domain/settings.js';
import { LIMITS, limitSettingKey } from '../../domain/limits.js';
import { formFromBody, formFromSettings } from '../../routes/pages/admin/settings.js';

test('formFromSettings shows stored numbers as text and a fallback to .env as blank', () => {
  const limits = Object.fromEntries(Object.keys(LIMITS).map((name, i) => [name, i === 0 ? 7 : null]));
  const switches = Object.fromEntries(OVERRIDE_SWITCHES.map(({ name }) => [name, true]));
  const form = formFromSettings({ switches, publicSharing: false, shareGridText: false, itemsPerPage: null, limits });
  assert.equal(form.switches, switches);
  assert.equal(form.publicSharing, false);
  assert.equal(form.shareGridText, false);
  assert.equal(form.itemsPerPage, '');
  const [first, ...rest] = Object.keys(LIMITS);
  assert.equal(form.limits[first], '7');
  for (const name of rest) assert.equal(form.limits[name], '', name);
  assert.equal(formFromSettings({ switches, publicSharing: true, itemsPerPage: 12, limits }).itemsPerPage, '12');
});

test('formFromBody: a present checkbox is on, text fields are trimmed, missing or non-text fields are blank', () => {
  const [first, second] = Object.keys(LIMITS);
  const [onSwitch, ...offSwitches] = OVERRIDE_SWITCHES;
  const form = formFromBody({
    [onSwitch.name]: 'on',
    public_sharing: 'on',
    share_grid_text: 'on',
    items_per_page: ' 24 ',
    [limitSettingKey(first)]: ' 9 ',
    [limitSettingKey(second)]: ['x'],
  });
  assert.equal(form.switches[onSwitch.name], true);
  for (const { name } of offSwitches) assert.equal(form.switches[name], false, name);
  assert.equal(form.publicSharing, true);
  assert.equal(form.shareGridText, true);
  assert.equal(form.itemsPerPage, '24');
  assert.equal(form.limits[first], '9');
  assert.equal(form.limits[second], '');
  assert.deepEqual(Object.keys(form.limits).sort(), Object.keys(LIMITS).sort());
  const empty = formFromBody({});
  assert.equal(empty.publicSharing, false);
  assert.equal(empty.shareGridText, false);
  assert.equal(empty.itemsPerPage, '');
});
