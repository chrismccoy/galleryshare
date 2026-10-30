import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedGallery } from '../helpers/gallery-seed.js';
import { allAttrValues, countAttr, elementByAttr, elementsByTag, statValue, textOf, withApp } from '../helpers/http.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

test('overview page: tiles for a seeded set and the Largest galleries table with Edit links', async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    const owner = await app.createUser();
    const ids = [1, 2, 3, 4, 5, 6].map((n) =>
      seedGallery(app.context, owner.id, { title: `G${n}`, images: n, bytes: 100 }),
    );
    app.context.galleries.trashById(ids[0]);
    const { res, html } = await app.get(admin, PATHS.admin.overview);
    assert.equal(res.status, 200);
    assert.deepEqual(allAttrValues(html, 'data-stat'), [
      'users',
      'admins',
      'galleries',
      'images',
      'avg-images',
      'storage',
      'shares',
      'trashed',
    ]);
    assert.equal(statValue(html, 'galleries'), '5');
    assert.equal(statValue(html, 'images'), '20');
    assert.equal(statValue(html, 'avg-images'), '4');
    assert.equal(statValue(html, 'trashed'), '1');
    assert.equal(statValue(html, 'storage'), '2.0 KB');
    assert.equal(statValue(html, 'admins'), '1');
    assert.match(html, /Largest galleries/);
    assert.equal(countAttr(html, 'data-largest-row'), 5);
    assert.ok(html.includes(`href="${PATH_TO.gallery(ids[5])}"`));
  });
});

test('overview page: empty state when there are no galleries', async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    const { html } = await app.get(admin, PATHS.admin.overview);
    assert.match(html, /No galleries yet\./);
  });
});

test("the overview's Recent activity card shows the five newest events of everyone, with From and a link to Activity", async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    const user = await app.signedIn({ displayName: 'Uma User' });
    const { activityService } = app.context;
    for (let i = 1; i <= 4; i++) {
      activityService.record({ kind: 'linkShared', actor: user.user, gallery: { id: 800 + i, title: `Uma ${i}` } });
    }
    activityService.record({ kind: 'signInFailed', actor: 'visitor', details: 'x@example.com', ip: '192.0.2.77' });
    const { html } = await app.get(admin, PATHS.admin.overview);
    const card = elementByAttr(html, 'data-widget', 'activity');
    assert.ok(card, 'the Recent activity card is drawn');
    assert.match(card, new RegExp(`href="${PATHS.admin.activity}"`));
    assert.match(card, /<th[^>]*>From<\/th>/);
    const rows = elementsByTag(card, 'tr').slice(1).map(textOf);
    assert.equal(rows.length, 5);
    assert.match(rows[0], /Sign-in failed.*192\.0\.2\.77/, "newest first, another user's and security events included");
    assert.match(rows[1], /Uma User.*Link shared.*Uma 4/);
  });
});
