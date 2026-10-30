import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { countAttr, olderHref, startApp, withApp } from '../helpers/http.js';
import { seedSharedGallery } from '../helpers/uploads.js';
import { SETTING_KEYS } from '../../domain/settings.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { assertNotFoundPage } from '../helpers/assertions.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

function sharedGallery(title = 'Shared one') {
  return seedSharedGallery(app, { title, images: 2, owner: { displayName: 'Olive Owner' } });
}

test('non-admins get 404 on the shared links pages', async () => {
  const s = await app.signedIn();
  const { shareId } = await sharedGallery();
  assert.equal((await app.get(s, PATHS.admin.shares)).res.status, 404);
  assert.equal((await app.get(s, PATH_TO.adminShare(shareId))).res.status, 404);
  assert.equal((await app.post(s, PATH_TO.adminShare(shareId, 'revoke'))).res.status, 404);
});

test('list shows gallery title, owner, status and a View link; revoke removes the row', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const { shareId, token } = await sharedGallery('Listed gallery');
  const { res, html } = await app.get(admin, PATHS.admin.shares);
  assert.equal(res.status, 200);
  assert.match(html, /Listed gallery/);
  assert.match(html, /Olive Owner/);
  assert.ok(html.includes(PATH_TO.share(token)));
  assert.doesNotMatch(html, /data-sharing-off/);
  const rev = await app.post(admin, PATH_TO.adminShare(shareId, 'revoke'));
  assert.equal(rev.res.status, 303);
  assert.equal(rev.res.headers.get('location'), `${PATHS.admin.shares}?notice=revoked`);
  const afterPage = (await app.get(admin, rev.res.headers.get('location'))).html;
  assert.match(afterPage, /Share link revoked\./);
  assert.ok(!afterPage.includes(PATH_TO.share(token)));
  assert.equal((await app.get(admin, PATH_TO.adminShare(shareId))).res.status, 404);
  assertNotFoundPage(await app.post(admin, PATH_TO.adminShare(shareId, 'revoke')), 'revoked again');
  assertNotFoundPage(await app.post(admin, PATH_TO.adminShare(99999, 'revoke')), 'unknown share');
});

test('detail lists views with kind Page or ZIP after a zip download', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const { shareId } = await sharedGallery('Detail gallery');
  const ua = 'Mozilla/5.0 Chrome/130.0 Safari/537.36';
  app.context.sharesService.recordView(shareId, { ip: '1.2.3.4', userAgent: ua, ownerId: 0 });
  app.context.sharesService.recordView(shareId, { ip: '5.6.7.8', userAgent: ua, ownerId: 0, kind: 'zip' });
  const { res, html } = await app.get(admin, PATH_TO.adminShare(shareId));
  assert.equal(res.status, 200);
  assert.match(html, /Detail gallery/);
  assert.match(html, /<td>ZIP<\/td>/);
  assert.match(html, /<td>Page<\/td>/);
  assert.equal(countAttr(html, 'data-view-row'), 2);
});

test('sharing off shows the banner on list and detail', async () => {
  await withApp(async (fresh) => {
    const admin = await fresh.signedIn({ role: 'admin' });
    const { shareId } = await seedSharedGallery(fresh, { images: 1 });
    fresh.context.settings.set(SETTING_KEYS.publicSharing, false);
    assert.match((await fresh.get(admin, PATHS.admin.shares)).html, /data-sharing-off/);
    assert.match((await fresh.get(admin, PATH_TO.adminShare(shareId))).html, /data-sharing-off/);
  });
});

test('Shared links pages by ITEMS_PER_PAGE with an "Older links" link, and neither the list nor a link page is cached', async () => {
  await withApp({ ITEMS_PER_PAGE: '5' }, async (fresh) => {
    const admin = await fresh.signedIn({ role: 'admin' });
    const shared = [];
    for (let i = 0; i < 6; i++) shared.push(await seedSharedGallery(fresh, { title: `Paged ${i}` }));
    const first = await fresh.get(admin, PATHS.admin.shares);
    assert.equal(first.res.headers.get('cache-control'), 'no-store');
    assert.equal(countAttr(first.html, 'data-share-row'), 5);
    const older = olderHref(first.html);
    assert.ok(older, 'an Older links link');
    const second = await fresh.get(admin, older);
    assert.equal(countAttr(second.html, 'data-share-row'), 1);
    assert.equal(olderHref(second.html), null, 'the last page has no pager');
    const detail = await fresh.get(admin, PATH_TO.adminShare(shared[0].shareId));
    assert.equal(detail.res.status, 200);
    assert.equal(detail.res.headers.get('cache-control'), 'no-store');
  });
});
