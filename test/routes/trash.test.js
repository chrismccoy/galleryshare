import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { countAttr, startApp, navCount, olderHref } from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { assertNotFoundPage } from '../helpers/assertions.js';

let app;
before(async () => {
  app = await startApp({ ITEMS_PER_PAGE: '5' }, { media: 'gs-trash-' });
});
after(() => app.close());

function seedMediaFolder(id) {
  const dir = path.join(app.root, 'media', String(id), 'thumb');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1.webp'), 'x');
  return path.join(app.root, 'media', String(id));
}

test('Trash requires sign-in; empty state renders', async () => {
  assert.equal((await app.request(PATHS.trash)).status, 303);
  const s = await app.signedIn();
  const { res, html } = await app.get(s, PATHS.trash);
  assert.equal(res.status, 200);
  assert.match(html, /Trash is empty\./);
  assert.doesNotMatch(html, /Empty trash/);
});

test('lists own trashed galleries with deleted and purge dates, cover and actions', async () => {
  const me = await app.signedIn();
  const other = await app.signedIn();
  const mine = seedGallery(app.context, me.user.id, { title: 'Mine', images: 1 });
  const theirs = seedGallery(app.context, other.user.id, { title: 'Theirs' });
  const live = seedGallery(app.context, me.user.id, { title: 'Live' });
  app.context.galleries.trashOwned(mine, me.user.id);
  app.context.galleries.trashOwned(theirs, other.user.id);
  const { html } = await app.get(me, PATHS.trash);
  assert.match(html, /Mine/);
  assert.doesNotMatch(html, /Theirs|Live/);
  assert.match(html, /30 days/);
  assert.match(html, /Deleted forever on \d{4}-\d{2}-\d{2}/);
  assert.match(html, /\/media\/\d+\/thumb/);
  assert.match(html, new RegExp(PATH_TO.trashItem(mine, 'restore')));
  assert.match(html, new RegExp(PATH_TO.trashItem(mine, 'purge')));
  assert.match(html, /Empty trash/);
  assert.equal(navCount(html, 'trash'), '1');
  assert.ok(live);
});

test('restore returns the gallery to My galleries and drops the badge', async () => {
  const me = await app.signedIn();
  const id = seedGallery(app.context, me.user.id, { title: 'Back' });
  app.context.galleries.trashOwned(id, me.user.id);
  const posted = await app.post(me, PATH_TO.trashItem(id, 'restore'));
  assert.equal(posted.res.status, 303);
  assert.equal(posted.res.headers.get('location'), `${PATHS.trash}?notice=restored`);
  const trash = await app.get(me, posted.res.headers.get('location'));
  assert.match(trash.html, /Gallery restored\./);
  assert.equal(navCount(trash.html, 'trash'), null);
  assert.match((await app.get(me, PATHS.galleries)).html, /Back/);
});

test('Delete forever removes the row and the media directory', async () => {
  const me = await app.signedIn();
  const id = seedGallery(app.context, me.user.id, { title: 'Gone' });
  const dir = seedMediaFolder(id);
  app.context.galleries.trashOwned(id, me.user.id);
  const posted = await app.post(me, PATH_TO.trashItem(id, 'purge'));
  assert.equal(posted.res.headers.get('location'), `${PATHS.trash}?notice=purged`);
  assert.equal(app.context.galleries.byIdIncludingTrashed(id), null);
  assert.equal(fs.existsSync(dir), false);
  assert.match((await app.get(me, posted.res.headers.get('location'))).html, /Gallery deleted forever\./);
});

test('another user cannot restore or purge (404); live gallery cannot be purged', async () => {
  const me = await app.signedIn();
  const other = await app.signedIn();
  const id = seedGallery(app.context, me.user.id);
  app.context.galleries.trashOwned(id, me.user.id);
  for (const action of ['restore', 'purge']) {
    assertNotFoundPage(await app.post(other, PATH_TO.trashItem(id, action)), action);
  }
  const live = seedGallery(app.context, me.user.id);
  assertNotFoundPage(await app.post(me, PATH_TO.trashItem(live, 'purge')), 'purge live');
  assertNotFoundPage(await app.post(me, PATH_TO.trashItem(live, 'restore')), 'restore live');
  assert.ok(app.context.galleries.liveById(live));
});

test('Empty Trash removes all own trashed galleries and media, not others or live ones', async () => {
  const me = await app.signedIn();
  const other = await app.signedIn();
  const a = seedGallery(app.context, me.user.id);
  const b = seedGallery(app.context, me.user.id);
  const live = seedGallery(app.context, me.user.id);
  const theirs = seedGallery(app.context, other.user.id);
  const dirs = [seedMediaFolder(a), seedMediaFolder(b)];
  for (const [g, u] of [
    [a, me],
    [b, me],
    [theirs, other],
  ])
    app.context.galleries.trashOwned(g, u.user.id);
  const posted = await app.post(me, PATHS.trashEmpty);
  assert.equal(posted.res.headers.get('location'), `${PATHS.trash}?notice=emptied`);
  assert.equal(app.context.galleries.countTrashed(me.user.id), 0);
  assert.ok(dirs.every((d) => !fs.existsSync(d)));
  assert.ok(app.context.galleries.liveById(live));
  assert.equal(app.context.galleries.countTrashed(other.user.id), 1);
  const { html } = await app.get(me, posted.res.headers.get('location'));
  assert.match(html, /Trash emptied\./);
  assert.match(html, /Trash is empty\./);
});

test('Trash pages at ITEMS_PER_PAGE', async () => {
  const me = await app.signedIn();
  for (let i = 0; i < 6; i++) {
    const id = seedGallery(app.context, me.user.id);
    app.context.galleries.trashOwned(id, me.user.id);
  }
  const p1 = await app.get(me, PATHS.trash);
  assert.equal(countAttr(p1.html, 'data-trash-row'), 5);
  const p2 = await app.get(me, olderHref(p1.html));
  assert.equal(countAttr(p2.html, 'data-trash-row'), 1);
});

test('media removal failure after the DB delete is logged, not thrown (Delete forever and Empty trash)', async (t) => {
  const me = await app.signedIn();
  const a = seedGallery(app.context, me.user.id);
  const b = seedGallery(app.context, me.user.id);
  for (const id of [a, b]) app.context.galleries.trashOwned(id, me.user.id);
  const error = t.mock.method(app.context.logger, 'error', () => {});
  t.mock.method(app.context.mediaStore, 'removeGallery', async () => {
    throw new Error('disk gone');
  });
  const one = await app.post(me, PATH_TO.trashItem(a, 'purge'));
  assert.equal(one.res.status, 303);
  assert.equal(one.res.headers.get('location'), `${PATHS.trash}?notice=purged`);
  assert.equal(app.context.galleries.byIdIncludingTrashed(a), null);
  const all = await app.post(me, PATHS.trashEmpty);
  assert.equal(all.res.status, 303);
  assert.equal(app.context.galleries.byIdIncludingTrashed(b), null);
  assert.deepEqual(
    error.mock.calls.map(({ arguments: [, meta] }) => [meta.galleryId, meta.error]),
    [
      [a, 'disk gone'],
      [b, 'disk gone'],
    ],
  );
});
