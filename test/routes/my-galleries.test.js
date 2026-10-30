import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { countAttr, elementsByAttr, startApp, navCount, olderHref } from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { assertSignInRedirect } from '../helpers/assertions.js';

let app;
before(async () => {
  app = await startApp({ ITEMS_PER_PAGE: '5' });
});
after(() => app.close());

test('My galleries requires sign-in', async () => {
  await assertSignInRedirect(app, PATHS.galleries);
});

test('empty state links to Add gallery', async () => {
  const s = await app.signedIn();
  const { res, html } = await app.get(s, PATHS.galleries);
  assert.equal(res.status, 200);
  assert.match(html, /No galleries yet\./);
  assert.match(html, /href="\/dashboard\/galleries\/new"/);
});

test('lists only own galleries, newest first, with count, size and default title', async () => {
  const me = await app.signedIn();
  const other = await app.signedIn();
  const first = seedGallery(app.context, me.user.id, { title: 'Alpha', images: 2, bytes: 1024 * 1024 });
  const second = seedGallery(app.context, me.user.id, { images: 0 });
  seedGallery(app.context, other.user.id, { title: 'Secret' });
  const { html } = await app.get(me, PATHS.galleries);
  assert.doesNotMatch(html, /Secret/);
  assert.match(html, /Alpha/);
  assert.match(html, /Untitled gallery/);
  assert.ok(html.indexOf(PATH_TO.gallery(second)) < html.indexOf(PATH_TO.gallery(first)), 'newest first');
  assert.match(html, /2\.0 MB/);
  assert.match(html, /\/media\/\d+\/thumb/);
  assert.match(html, /Move to Trash\?/);
  assert.match(html, /Edit/);
});

test('pages at ITEMS_PER_PAGE with an Older galleries link', async () => {
  const me = await app.signedIn();
  for (let i = 0; i < 7; i++) seedGallery(app.context, me.user.id, { title: `G${i}` });
  const page1 = await app.get(me, PATHS.galleries);
  assert.equal(countAttr(page1.html, 'data-gallery-row'), 5);
  assert.match(page1.html, /Older galleries/);
  const page2 = await app.get(me, olderHref(page1.html));
  assert.equal(countAttr(page2.html, 'data-gallery-row'), 2);
  assert.doesNotMatch(page2.html, /Older galleries/);
});

test('Delete moves to Trash, shows the notice and bumps the badge; row is gone', async () => {
  const me = await app.signedIn();
  const id = seedGallery(app.context, me.user.id, { title: 'Bye' });
  const posted = await app.post(me, PATH_TO.gallery(id, 'delete'));
  assert.equal(posted.res.status, 303);
  assert.equal(posted.res.headers.get('location'), `${PATHS.galleries}?notice=trashed`);
  const { html } = await app.get(me, posted.res.headers.get('location'));
  assert.match(html, /Moved to Trash\./);
  assert.match(html, /href="\/dashboard\/trash"/);
  assert.doesNotMatch(html, /data-gallery-row/);
  assert.equal(navCount(html, 'trash'), '1');
});

test('rows of galleries with a live share link carry the Shared pill', async () => {
  const me = await app.signedIn();
  const shared = seedGallery(app.context, me.user.id, { title: 'Shared gallery' });
  seedGallery(app.context, me.user.id, { title: 'Quiet gallery' });
  app.context.sharesService.share(me.user, shared);
  const { html } = await app.get(me, PATHS.galleries);
  const rows = elementsByAttr(html, 'data-gallery-row');
  const row = (title) => {
    const found = rows.filter((r) => r.includes(title));
    assert.equal(found.length, 1, `one row for ${title}`);
    return found[0];
  };
  assert.equal(countAttr(row('Shared gallery'), 'data-shared-pill'), 1);
  assert.equal(countAttr(row('Quiet gallery'), 'data-shared-pill'), 0);
});
