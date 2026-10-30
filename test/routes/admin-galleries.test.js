import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { countAttr, olderHref, startApp } from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const rowsOf = (html) => countAttr(html, 'data-gallery-row');

test('non-admins get 404 on the admin galleries page', async () => {
  const s = await app.signedIn();
  assert.equal((await app.get(s, PATHS.admin.galleries)).res.status, 404);
});

test("lists every user's galleries with owner, size and a Shared pill; filters by ?user", async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const a = await app.createUser({ displayName: 'Alice Alpha' });
  const b = await app.createUser({ displayName: 'Bob Beta' });
  const ga = seedGallery(app.context, a.id, { title: 'Alice trip', images: 2, bytes: 1024 });
  seedGallery(app.context, b.id, { title: 'Bob party', images: 1 });
  app.context.sharesService.share(a, ga);

  const { res, html } = await app.get(admin, PATHS.admin.galleries);
  assert.equal(res.status, 200);
  assert.match(html, /Alice Alpha/);
  assert.match(html, /Bob Beta/);
  assert.match(html, /Alice trip/);
  assert.match(html, /2\.0 KB/);
  assert.equal(countAttr(html, 'data-shared-pill'), 1);

  const filtered = (await app.get(admin, `${PATHS.admin.galleries}?user=${b.id}`)).html;
  assert.match(filtered, /Bob party/);
  assert.doesNotMatch(filtered, /Alice trip/);
  assert.equal(rowsOf(filtered), 1);
  const junk = (await app.get(admin, `${PATHS.admin.galleries}?user=abc`)).html;
  assert.match(junk, /Alice trip/);
});

test('pages with an Older galleries link', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const u = await app.createUser();
  const limit = app.context.effectiveConfigService.pageSize().value;
  for (let i = 0; i < limit + 1; i++) seedGallery(app.context, u.id);
  const first = (await app.get(admin, `${PATHS.admin.galleries}?user=${u.id}`)).html;
  assert.equal(rowsOf(first), limit);
  const next = olderHref(first);
  assert.ok(next);
  const second = (await app.get(admin, next)).html;
  assert.equal(rowsOf(second), 1);
});

test("Edit link opens the edit view and saving works; Move to Trash lands in the owner's Trash", async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const owner = await app.createUser();
  const id = seedGallery(app.context, owner.id, { title: 'Before', images: 1 });
  const { html } = await app.get(admin, `${PATHS.admin.galleries}?user=${owner.id}`);
  assert.ok(html.includes(`href="${PATH_TO.gallery(id)}"`));
  assert.ok(html.includes(`action="${PATH_TO.gallery(id, 'delete')}"`));
  assert.equal((await app.get(admin, PATH_TO.gallery(id))).res.status, 200);
  assert.equal((await app.post(admin, PATH_TO.gallery(id, 'meta'), { title: 'After' })).res.status, 303);
  assert.equal(app.context.galleries.liveById(id).title, 'After');

  const del = await app.post(admin, PATH_TO.gallery(id, 'delete'));
  assert.equal(del.res.status, 303);
  assert.equal(del.res.headers.get('location'), `${PATHS.admin.galleries}?notice=trashed`);
  assert.equal(app.context.galleries.liveById(id), null);
  assert.equal(app.context.galleries.trashedForUser(owner.id, {}).length, 1);
  const afterPage = (await app.get(admin, del.res.headers.get('location'))).html;
  assert.match(afterPage, /Moved to Trash\./);
  assert.doesNotMatch(afterPage, />After</);
});
