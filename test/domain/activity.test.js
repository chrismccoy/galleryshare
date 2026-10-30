import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, EVENTS, MAX_ACTIVITY_TEXT, USER_HIDDEN_AREAS, browserName } from '../../domain/activity.js';

test('every event has a known area and a label, and the table is frozen', () => {
  const areas = Object.values(AREAS);
  for (const [kind, event] of Object.entries(EVENTS)) {
    assert.ok(areas.includes(event.area), kind);
    assert.ok(event.label, kind);
  }
  assert.ok(Object.isFrozen(EVENTS));
  assert.ok(Object.values(EVENTS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(AREAS) && Object.isFrozen(USER_HIDDEN_AREAS));
  assert.deepEqual(EVENTS.linkShared, { area: 'sharing', label: 'Link shared' });
  assert.deepEqual(EVENTS.signInFailed, { area: 'security', label: 'Sign-in failed' });
});

test('the areas, the areas hidden from users and the text limit are fixed', () => {
  assert.deepEqual(Object.values(AREAS), ['accounts', 'galleries', 'sharing', 'settings', 'security', 'system']);
  assert.deepEqual([...USER_HIDDEN_AREAS], ['security', 'system']);
  assert.equal(MAX_ACTIVITY_TEXT, 300);
});

test('browserName gives a short name, or the cut-down text for an unknown agent', () => {
  assert.equal(browserName(null), null);
  assert.equal(
    browserName('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
    'Chrome',
  );
  assert.equal(
    browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120'),
    'Edge',
  );
  assert.equal(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'), 'Firefox');
  assert.equal(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17 Safari/605.1.15'), 'Safari');
  assert.equal(browserName('x'.repeat(100)), 'x'.repeat(40));
});
