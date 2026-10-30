import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, elementsByAttr, startApp, textOf } from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { withSettings } from '../helpers/settings.js';
import { PATH_TO } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp({ RATE_LIMIT_PUBLIC_FORM_MAX: '1000' });
});
after(() => app.close());

const statusNotices = (html) => elementsByAttr(html, 'role', 'status').map(textOf).filter(Boolean);

const STRIP_COPY = "Anyone with this link can see this gallery. It doesn't expire.";
const SHARING_OFF = "Public share links are turned off in Settings. These links don't work until it's turned back on.";
const UNRESHOWABLE_COPY = "This link can't be shown again. Revoke it and share again to get a new one.";

function shareUrls(html) {
  return [...new Set(html.match(/https?:\/\/[^"'\s<]+\/s\/[0-9A-Za-z]{7}(?![0-9A-Za-z/])/g) ?? [])];
}

const hasShareButton = (html, id) => html.includes(`action="${PATH_TO.gallery(id, 'share')}"`);
const hasRevoke = (html, id) => html.includes(`action="${PATH_TO.gallery(id, 'unshare')}"`);

test('share creates a link; the edit view shows it with Copy and Revoke; sharing again keeps it', async () => {
  const s = await app.signedIn();
  const id = seedGallery(app.context, s.user.id, { images: 2 });

  const before = await app.get(s, PATH_TO.gallery(id));
  assert.ok(hasShareButton(before.html, id), 'Share button before sharing');
  assert.equal(shareUrls(before.html).length, 0);
  assert.ok(!before.html.includes('data-shared-pill'));

  const { res } = await app.post(s, PATH_TO.gallery(id, 'share'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${PATH_TO.gallery(id)}?notice=shared`);

  const page = await app.get(s, `${PATH_TO.gallery(id)}?notice=shared`);
  assert.equal(page.res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(statusNotices(page.html), ['Share link created.']);
  const urls = shareUrls(page.html);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith(`${app.url}${PATH_TO.share('')}`), urls[0]);
  assert.ok(decodeEntities(page.html).includes(STRIP_COPY), 'exact strip copy');
  assert.ok(page.html.includes(`data-copy-link="${urls[0]}"`), 'Copy button carries the URL');
  assert.ok(hasRevoke(page.html, id), 'Revoke confirm');
  assert.ok(!hasShareButton(page.html, id), 'no Share button once shared');
  assert.ok(page.html.includes('data-shared-pill'), 'Shared pill');
  assert.ok(page.html.includes('/js/copy-link.js'));

  const token = urls[0].split('/s/')[1];
  assert.equal((await app.request(PATH_TO.share(token))).status, 200, 'the shown link works');

  const again = await app.post(s, PATH_TO.gallery(id, 'share'));
  assert.equal(again.res.status, 303);
  assert.deepEqual(shareUrls((await app.get(s, PATH_TO.gallery(id))).html), urls, 'same URL');
});

test('revoke removes the link and says so', async () => {
  const s = await app.signedIn();
  const id = seedGallery(app.context, s.user.id, { images: 1 });
  await app.post(s, PATH_TO.gallery(id, 'share'));
  const token = shareUrls((await app.get(s, PATH_TO.gallery(id))).html)[0].split('/s/')[1];

  const { res } = await app.post(s, PATH_TO.gallery(id, 'unshare'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${PATH_TO.gallery(id)}?notice=unshared`);
  const page = await app.get(s, `${PATH_TO.gallery(id)}?notice=unshared`);
  assert.deepEqual(statusNotices(page.html), ['Share link revoked.']);
  assert.equal(shareUrls(page.html).length, 0);
  assert.ok(!hasRevoke(page.html, id));
  assert.ok(hasShareButton(page.html, id));
  assert.equal((await app.request(PATH_TO.share(token))).status, 404);
  assert.equal((await app.post(s, PATH_TO.gallery(id, 'unshare'))).res.status, 404, 'nothing left to revoke');
});

test("an admin can share, copy and revoke another user's gallery from the edit view", async () => {
  const owner = await app.signedIn();
  const admin = await app.signedIn({ role: 'admin' });
  const id = seedGallery(app.context, owner.user.id, { images: 1 });
  const shared = await app.post(admin, PATH_TO.gallery(id, 'share'));
  assert.equal(shared.res.status, 303);
  const adminView = await app.get(admin, PATH_TO.gallery(id));
  const urls = shareUrls(adminView.html);
  assert.equal(urls.length, 1);
  assert.ok(adminView.html.includes(`data-copy-link="${urls[0]}"`));
  assert.deepEqual(shareUrls((await app.get(owner, PATH_TO.gallery(id))).html), urls, 'the owner sees the same link');
  const revoked = await app.post(admin, PATH_TO.gallery(id, 'unshare'));
  assert.equal(revoked.res.status, 303);
  assert.equal(app.context.shares.liveForGallery(id), null);
});

test("another user can neither share, see nor revoke the owner's link", async () => {
  const owner = await app.signedIn();
  const stranger = await app.signedIn();
  const id = seedGallery(app.context, owner.user.id, { images: 1 });
  assert.equal((await app.post(stranger, PATH_TO.gallery(id, 'share'))).res.status, 404);
  assert.equal(app.context.shares.liveForGallery(id), null);
  app.context.sharesService.share(owner.user, id);
  assert.equal((await app.get(stranger, PATH_TO.gallery(id))).res.status, 404);
  assert.equal((await app.post(stranger, PATH_TO.gallery(id, 'unshare'))).res.status, 404);
  assert.ok(app.context.shares.liveForGallery(id), 'still live');
  assert.equal((await app.post(stranger, PATH_TO.gallery(999999, 'share'))).res.status, 404);
});

test('a share POST without the CSRF token is refused', async () => {
  const s = await app.signedIn();
  const id = seedGallery(app.context, s.user.id);
  const { res } = await app.post(s, PATH_TO.gallery(id, 'share'), {}, { csrf: 'wrong' });
  assert.equal(res.status, 403);
  assert.equal(app.context.shares.liveForGallery(id), null);
});

test('global sharing off: Share is disabled with the sharing-off notice; a forced POST is 403; Revoke still works', async (t) => {
  const setSettings = withSettings(t, app.context);
  const s = await app.signedIn();
  const id = seedGallery(app.context, s.user.id, { images: 1 });
  const sharedId = seedGallery(app.context, s.user.id, { images: 1 });
  app.context.sharesService.share(s.user, sharedId);
  setSettings({ publicSharing: false });

  const page = await app.get(s, PATH_TO.gallery(id));
  assert.ok(decodeEntities(page.html).includes(SHARING_OFF), 'sharing-off notice');
  assert.match(page.html, /<button[^>]*disabled[^>]*data-share-disabled|data-share-disabled[^>]*disabled/);
  assert.ok(!hasShareButton(page.html, id), 'no working Share form');

  const forced = await app.post(s, PATH_TO.gallery(id, 'share'));
  assert.equal(forced.res.status, 403);
  assert.match(forced.html, /Sharing is turned off\./);
  assert.equal(app.context.shares.liveForGallery(id), null);

  const sharedPage = await app.get(s, PATH_TO.gallery(sharedId));
  assert.ok(decodeEntities(sharedPage.html).includes(SHARING_OFF));
  assert.ok(hasRevoke(sharedPage.html, sharedId), 'the owner can still kill the link');
  assert.equal((await app.post(s, PATH_TO.gallery(sharedId, 'unshare'))).res.status, 303);
});

test('a link that cannot be derived again offers only Revoke', async () => {
  const s = await app.signedIn();
  const id = seedGallery(app.context, s.user.id, { images: 1 });
  app.context.sharesService.share(s.user, id);
  app.context.db.prepare("UPDATE gallery_shares SET nonce = 'other' WHERE gallery_id = ?").run(id);
  const page = await app.get(s, PATH_TO.gallery(id));
  assert.ok(decodeEntities(page.html).includes(UNRESHOWABLE_COPY));
  assert.equal(shareUrls(page.html).length, 0);
  assert.ok(hasRevoke(page.html, id));
  assert.ok(!hasShareButton(page.html, id));
});
