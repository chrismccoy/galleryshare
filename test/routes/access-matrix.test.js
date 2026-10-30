import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { elementByAttr, navCount, startApp, statValue } from '../helpers/http.js';
import { makeJpeg } from '../helpers/images.js';
import { postFiles, uploadGallery } from '../helpers/uploads.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { UNAVAILABLE_MESSAGE } from '../../domain/share-links.js';
import { assertSignInRedirect } from '../helpers/assertions.js';

let app;
let jpeg;
const as = {};
let live;
let trashed;

async function uploadedGallery(session, title) {
  const { galleryId, jobId } = await uploadGallery(app, session, [{ name: 'a.jpg', data: jpeg }]);
  app.context.galleriesService.saveEdits(session.user, galleryId, { meta: { title }, images: [] });
  const [{ id: imageId }] = app.context.galleryImages.forGallery(galleryId);
  return { galleryId, imageId, jobId };
}

async function ask(who, path, { method = 'GET', form = {} } = {}) {
  let res;
  let html;
  if (who === 'anon') {
    res = await app.request(path, method === 'POST' ? { method, form } : {});
    html = await res.text();
  } else if (method === 'POST') {
    ({ res, html } = await app.post(as[who], path, form));
  } else {
    ({ res, html } = await app.get(as[who], path));
  }
  return { status: res.status, location: res.headers.get('location'), html };
}

async function reorderStatus(who, galleryId, ids) {
  const res = await app.request(PATH_TO.gallery(galleryId, 'reorder'), {
    method: 'POST',
    body: JSON.stringify({ ids }),
    cookie: as[who].cookie,
    headers: { 'content-type': 'application/json', 'x-csrf-token': as[who].csrf },
  });
  await res.arrayBuffer();
  return res.status;
}

const isUnavailablePage = (html) => html.replaceAll('&#39;', "'").includes(UNAVAILABLE_MESSAGE);

async function sharedUpload(session, title) {
  const { galleryId } = await uploadedGallery(session, title);
  app.context.galleriesService.saveEdits(session.user, galleryId, { meta: { allowZip: true }, images: [] });
  const { token } = app.context.sharesService.share(session.user, galleryId);
  const [{ public_name: publicName }] = app.context.galleryImages.forGallery(galleryId);
  return {
    galleryId,
    token,
    paths: [PATH_TO.share(token), PATH_TO.shareImage(token, publicName, 'web'), PATH_TO.shareZip(token)],
  };
}

before(async () => {
  app = await startApp({ RATE_LIMIT_SHARE_MAX: '1000', RATE_LIMIT_ZIP_MAX: '1000' }, { media: 'gs-access-' });
  jpeg = await makeJpeg({ width: 40, height: 30 });
  as.owner = await app.signedIn({ displayName: 'Owner' });
  as.other = await app.signedIn({ displayName: 'Other' });
  as.admin = await app.signedIn({ role: 'admin', displayName: 'Admin' });
  live = await uploadedGallery(as.owner, 'MatrixLive');
  trashed = await uploadedGallery(as.owner, 'MatrixTrashed');
  app.context.galleriesService.trash(as.owner.user, trashed.galleryId);
});
after(() => app.close());

test('dashboard: sign-in required; each user sees only their own galleries and totals (admins too)', async () => {
  await assertSignInRedirect(app, PATHS.dashboard);
  const owner = await ask('owner', PATHS.dashboard);
  assert.equal(owner.status, 200);
  const cards = elementByAttr(owner.html, 'data-widget', 'galleries');
  assert.match(cards, /MatrixLive/);
  assert.doesNotMatch(cards, /MatrixTrashed/);
  assert.equal(statValue(owner.html, 'galleries'), '1');
  assert.equal(statValue(owner.html, 'images'), '1');
  for (const who of ['other', 'admin']) {
    const page = await ask(who, PATHS.dashboard);
    assert.equal(page.status, 200, who);
    assert.doesNotMatch(page.html, /MatrixLive|MatrixTrashed/, who);
    assert.equal(statValue(page.html, 'galleries'), '0', who);
    assert.equal(statValue(page.html, 'storage'), '0 B', who);
  }
});

test('My galleries: sign-in required; only own live galleries are listed (admins too)', async () => {
  await assertSignInRedirect(app, PATHS.galleries);
  const owner = await ask('owner', PATHS.galleries);
  assert.equal(owner.status, 200);
  assert.match(owner.html, /MatrixLive/);
  assert.doesNotMatch(owner.html, /MatrixTrashed/);
  for (const who of ['other', 'admin']) {
    const page = await ask(who, PATHS.galleries);
    assert.equal(page.status, 200, who);
    assert.doesNotMatch(page.html, /MatrixLive|MatrixTrashed/, who);
  }
});

test('Trash list: sign-in required; only own trashed galleries are listed (admins too)', async () => {
  await assertSignInRedirect(app, PATHS.trash);
  const owner = await ask('owner', PATHS.trash);
  assert.equal(owner.status, 200);
  assert.match(owner.html, /MatrixTrashed/);
  assert.doesNotMatch(owner.html, /MatrixLive/);
  for (const who of ['other', 'admin']) {
    const page = await ask(who, PATHS.trash);
    assert.equal(page.status, 200, who);
    assert.doesNotMatch(page.html, /MatrixLive|MatrixTrashed/, who);
  }
});

test('Trash actions: only the owner restores or purges; an admin and other users get 404; signed out is refused', async () => {
  const id = seedGallery(app.context, as.owner.user.id, { title: 'TrashAction' });
  app.context.galleries.trashOwned(id, as.owner.user.id);
  for (const action of ['restore', 'purge']) {
    const anon = await ask('anon', PATH_TO.trashItem(id, action), { method: 'POST' });
    assert.equal(anon.status, 403, `anon ${action}`);
    for (const who of ['other', 'admin']) {
      assert.equal((await ask(who, PATH_TO.trashItem(id, action), { method: 'POST' })).status, 404, `${who} ${action}`);
    }
  }
  assert.equal((await ask('admin', PATHS.trashEmpty, { method: 'POST' })).status, 303);
  assert.ok(app.context.galleries.byIdIncludingTrashed(id).deleted_at);
  assert.ok(app.context.galleries.byIdIncludingTrashed(trashed.galleryId).deleted_at);
  assert.equal((await ask('owner', PATH_TO.trashItem(live.galleryId, 'restore'), { method: 'POST' })).status, 404);
  assert.equal((await ask('owner', PATH_TO.trashItem(live.galleryId, 'purge'), { method: 'POST' })).status, 404);
  const restored = await ask('owner', PATH_TO.trashItem(id, 'restore'), { method: 'POST' });
  assert.equal(restored.status, 303);
  assert.equal(restored.location, `${PATHS.trash}?notice=restored`);
  assert.equal(app.context.galleries.liveById(id).deleted_at, null);
});

test('media: the owner and admins see live and trashed galleries; other users get 404; signed out goes to sign-in', async () => {
  for (const { imageId } of [live, trashed]) {
    for (const size of ['thumb', 'web']) {
      const path = PATH_TO.media(imageId, size);
      await assertSignInRedirect(app, path);
      assert.equal(await app.status(path, { cookie: as.owner.cookie }), 200, `owner ${path}`);
      assert.equal(await app.status(path, { cookie: as.admin.cookie }), 200, `admin ${path}`);
      assert.equal(await app.status(path, { cookie: as.other.cookie }), 404, `other ${path}`);
    }
    assert.equal(await app.status(PATH_TO.media(imageId, 'orig'), { cookie: as.admin.cookie }), 404);
  }
});

test('ingest job page: the job user or a gallery editor (Trash included) may see it; others get 404', async () => {
  for (const { jobId, galleryId } of [live, trashed]) {
    const path = PATH_TO.ingestJob(jobId);
    await assertSignInRedirect(app, path);
    for (const who of ['owner', 'admin']) {
      const page = await ask(who, path);
      assert.equal(page.status, 303, `${who} ${path}`);
      assert.equal(page.location, `${PATH_TO.gallery(galleryId)}?notice=added`, `${who} ${path}`);
    }
    assert.equal((await ask('other', path)).status, 404, path);
  }
  assert.equal((await ask('owner', PATH_TO.ingestJob(999999))).status, 404);

  const failedLive = app.context.ingestJobs.insert({ userId: as.owner.user.id, galleryId: live.galleryId, total: 1 });
  app.context.ingestJobs.setFailed(failedLive, 'Broken.');
  const failedTrashed = app.context.ingestJobs.insert({
    userId: as.owner.user.id,
    galleryId: trashed.galleryId,
    total: 1,
  });
  app.context.ingestJobs.setFailed(failedTrashed, 'Broken.');
  for (const who of ['owner', 'admin']) {
    const onLive = await ask(who, PATH_TO.ingestJob(failedLive));
    assert.equal(onLive.status, 200, who);
    assert.match(onLive.html, /Open the gallery/, who);
    const onTrashed = await ask(who, PATH_TO.ingestJob(failedTrashed));
    assert.equal(onTrashed.status, 200, who);
    assert.doesNotMatch(onTrashed.html, /Open the gallery/, who);
  }
  assert.equal((await ask('other', PATH_TO.ingestJob(failedLive))).status, 404);
  assert.equal((await ask('other', PATH_TO.ingestJob(failedTrashed))).status, 404);

  const byAdmin = app.context.ingestJobs.insert({ userId: as.admin.user.id, galleryId: live.galleryId, total: 1 });
  app.context.ingestJobs.setFailed(byAdmin, 'Broken.');
  assert.equal((await ask('owner', PATH_TO.ingestJob(byAdmin))).status, 200);
  assert.equal((await ask('admin', PATH_TO.ingestJob(byAdmin))).status, 200);
  assert.equal((await ask('other', PATH_TO.ingestJob(byAdmin))).status, 404);

  const own = seedGallery(app.context, as.other.user.id);
  const ownJob = app.context.ingestJobs.insert({ userId: as.other.user.id, galleryId: own, total: 1 });
  app.context.ingestJobs.setFailed(ownJob, 'Broken.');
  app.context.galleries.trashOwned(own, as.other.user.id);
  assert.equal((await ask('other', PATH_TO.ingestJob(ownJob))).status, 200);
  assert.equal((await ask('owner', PATH_TO.ingestJob(ownJob))).status, 404);
});

test('edit view: the owner and admins open a live gallery; other users get 404; Trash is 404 for everyone', async () => {
  await assertSignInRedirect(app, PATH_TO.gallery(live.galleryId));
  for (const who of ['owner', 'admin']) {
    const page = await ask(who, PATH_TO.gallery(live.galleryId));
    assert.equal(page.status, 200, who);
    assert.match(page.html, /MatrixLive/, who);
  }
  assert.equal((await ask('other', PATH_TO.gallery(live.galleryId))).status, 404);
  for (const who of ['owner', 'admin', 'other']) {
    assert.equal((await ask(who, PATH_TO.gallery(trashed.galleryId))).status, 404, who);
  }
  assert.equal((await ask('owner', PATH_TO.gallery(999999))).status, 404);
});

test('edit actions on a gallery in Trash are 404 for the owner and admins, and change nothing', async () => {
  const id = trashed.galleryId;
  const image = trashed.imageId;
  for (const who of ['owner', 'admin']) {
    for (const action of ['meta', 'share', 'unshare', 'delete']) {
      const res = await ask(who, PATH_TO.gallery(id, action), { method: 'POST', form: { title: 'Changed' } });
      assert.equal(res.status, 404, `${who} ${action}`);
    }
    for (const path of [PATH_TO.galleryImage(id, image), PATH_TO.galleryImage(id, image, 'remove')]) {
      const res = await ask(who, path, { method: 'POST', form: { title: 'Changed' } });
      assert.equal(res.status, 404, `${who} ${path}`);
    }
    assert.equal(await reorderStatus(who, id, [image]), 404, `${who} reorder`);
  }
  const row = app.context.galleries.byIdIncludingTrashed(id);
  assert.equal(row.title, 'MatrixTrashed');
  assert.ok(row.deleted_at);
  assert.equal(app.context.galleryImages.byId(image).title, null);
  assert.equal(app.context.sharesService.liveGalleryIds(as.owner.user.id).has(id), false);
});

test('share and unshare: the owner and admins manage the link; other users get 404; signed out is refused', async () => {
  const id = seedGallery(app.context, as.owner.user.id, { title: 'ShareMatrix', images: 1 });
  assert.equal((await ask('anon', PATH_TO.gallery(id, 'share'), { method: 'POST' })).status, 403);
  assert.equal((await ask('other', PATH_TO.gallery(id, 'share'), { method: 'POST' })).status, 404);
  assert.deepEqual(app.context.sharesService.liveGalleryIds(as.owner.user.id).has(id), false);
  for (const who of ['owner', 'admin']) {
    const shared = await ask(who, PATH_TO.gallery(id, 'share'), { method: 'POST' });
    assert.equal(shared.status, 303, `${who} share`);
    assert.equal(shared.location, `${PATH_TO.gallery(id)}?notice=shared`);
    assert.equal((await ask('other', PATH_TO.gallery(id, 'unshare'), { method: 'POST' })).status, 404);
    const unshared = await ask(who, PATH_TO.gallery(id, 'unshare'), { method: 'POST' });
    assert.equal(unshared.status, 303, `${who} unshare`);
    assert.equal((await ask(who, PATH_TO.gallery(id, 'unshare'), { method: 'POST' })).status, 404, `${who} again`);
  }
});

test('Move to Trash: the owner lands on My galleries, an admin on the admin list; other users get 404', async () => {
  const mine = seedGallery(app.context, as.owner.user.id, { title: 'ToTrashOwner' });
  const theirs = seedGallery(app.context, as.owner.user.id, { title: 'ToTrashAdmin' });
  assert.equal((await ask('other', PATH_TO.gallery(mine, 'delete'), { method: 'POST' })).status, 404);
  assert.equal(app.context.galleries.liveById(mine).deleted_at, null);
  const byOwner = await ask('owner', PATH_TO.gallery(mine, 'delete'), { method: 'POST' });
  assert.equal(byOwner.status, 303);
  assert.equal(byOwner.location, `${PATHS.galleries}?notice=trashed`);
  const byAdmin = await ask('admin', PATH_TO.gallery(theirs, 'delete'), { method: 'POST' });
  assert.equal(byAdmin.status, 303);
  assert.equal(byAdmin.location, `${PATHS.admin.galleries}?notice=trashed`);
  assert.ok(app.context.galleries.byIdIncludingTrashed(theirs).deleted_at);
});

test('add-images upload: the owner and admins add to a live gallery; other users and Trash get 404', async () => {
  const files = [{ name: 'b.jpg', data: jpeg }];
  for (const who of ['owner', 'admin']) {
    const res = await postFiles(app, as[who], PATH_TO.gallery(live.galleryId, 'upload'), files);
    await res.arrayBuffer();
    assert.equal(res.status, 303, who);
    assert.match(res.headers.get('location'), new RegExp(`^${PATHS.ingestJobs}/\\d+$`), who);
  }
  await app.context.ingestService.idle();
  const before = app.context.galleryImages.count(live.galleryId);
  for (const [who, id] of [
    ['other', live.galleryId],
    ['owner', trashed.galleryId],
    ['admin', trashed.galleryId],
  ]) {
    const res = await postFiles(app, as[who], PATH_TO.gallery(id, 'upload'), files);
    await res.arrayBuffer();
    assert.equal(res.status, 404, `${who} ${id}`);
  }
  await app.context.ingestService.idle();
  assert.equal(app.context.galleryImages.count(live.galleryId), before);
  assert.equal(app.context.galleryImages.count(trashed.galleryId), 1);
});

test('admin galleries list: admins only; it lists live galleries of every owner, not Trash', async () => {
  await assertSignInRedirect(app, PATHS.admin.galleries);
  for (const who of ['owner', 'other']) {
    assert.equal((await ask(who, PATHS.admin.galleries)).status, 404, who);
  }
  const page = await ask('admin', PATHS.admin.galleries);
  assert.equal(page.status, 200);
  assert.match(page.html, /MatrixLive/);
  assert.doesNotMatch(page.html, /MatrixTrashed/);
  const filtered = await ask('admin', `${PATHS.admin.galleries}?user=${as.other.user.id}`);
  assert.equal(filtered.status, 200);
  assert.doesNotMatch(filtered.html, /MatrixLive/);
});

test('nav badges: Trash counts only the viewer’s own Trash; the shares badge is for admins only', async () => {
  const badge = (count) => (count ? String(count) : null);
  const ownerTrash = app.context.galleries.countTrashed(as.owner.user.id);
  assert.ok(ownerTrash > 0);
  const owner = await ask('owner', PATHS.dashboard);
  assert.equal(navCount(owner.html, 'trash'), badge(ownerTrash));
  assert.equal(navCount(owner.html, 'shares'), null);
  const other = await ask('other', PATHS.dashboard);
  assert.equal(navCount(other.html, 'trash'), badge(app.context.galleries.countTrashed(as.other.user.id)));
  const admin = await ask('admin', PATHS.dashboard);
  assert.equal(navCount(admin.html, 'trash'), null);
  app.context.sharesService.share(as.owner.user, live.galleryId);
  const withLink = await ask('admin', PATHS.dashboard);
  assert.equal(navCount(withLink.html, 'shares'), badge(app.context.sharesService.countLive()));
  assert.equal(navCount((await ask('owner', PATHS.dashboard)).html, 'shares'), null);
});

test('public share page: open to anyone while the gallery is live; paused while it is in Trash', async () => {
  const id = seedGallery(app.context, as.owner.user.id, { title: 'PublicMatrix', images: 1 });
  const { token } = app.context.sharesService.share(as.owner.user, id);
  for (const who of ['anon', 'other', 'admin', 'owner']) {
    assert.equal((await ask(who, PATH_TO.share(token))).status, 200, who);
  }
  app.context.galleriesService.trash(as.owner.user, id);
  for (const who of ['anon', 'other', 'admin', 'owner']) {
    assert.equal((await ask(who, PATH_TO.share(token))).status, 404, who);
  }
});

test('public share of a disabled owner: refused for everyone with the generic unavailable page; back once enabled', async () => {
  const session = await app.signedIn({ displayName: 'Disabled owner' });
  const { paths } = await sharedUpload(session, 'DisabledOwnerMatrix');
  for (const path of paths) assert.equal((await ask('anon', path)).status, 200, path);
  app.context.users.setDisabled(session.user.id, true);
  for (const who of ['anon', 'other', 'admin']) {
    for (const path of paths) assert.equal((await ask(who, path)).status, 404, `${who} ${path}`);
    const page = await ask(who, paths[0]);
    assert.ok(isUnavailablePage(page.html), `${who} gets the unavailable page`);
    assert.doesNotMatch(page.html, /DisabledOwnerMatrix|disabled/i, `${who}: no reason is given`);
  }
  app.context.users.setDisabled(session.user.id, false);
  assert.equal((await ask('anon', paths[0])).status, 200);
});

test('a paused link (gallery in Trash): refused publicly, kept live for restore, revocable by an admin only from Shared links', async () => {
  const { galleryId, token, paths } = await sharedUpload(as.owner, 'PausedMatrix');
  const shareId = app.context.sharesService.resolve(token).share.id;
  app.context.galleriesService.trash(as.owner.user, galleryId);
  for (const who of ['anon', 'other', 'admin', 'owner']) {
    for (const path of paths) assert.equal((await ask(who, path)).status, 404, `${who} ${path}`);
    assert.ok(isUnavailablePage((await ask(who, paths[0])).html), who);
  }
  for (const who of ['owner', 'admin']) {
    assert.equal((await ask(who, PATH_TO.gallery(galleryId, 'unshare'), { method: 'POST' })).status, 404, who);
  }
  assert.equal(app.context.shares.byId(shareId).revoked_at, null, 'paused, not revoked');
  const list = await ask('admin', PATHS.admin.shares);
  assert.equal(list.status, 200);
  assert.match(list.html, /PausedMatrix/);
  assert.match(list.html, /Paused: in Trash/);
  for (const who of ['owner', 'other']) {
    assert.equal((await ask(who, PATH_TO.adminShare(shareId, 'revoke'), { method: 'POST' })).status, 404, who);
  }
  app.context.galleriesService.restore(as.owner.user, galleryId);
  for (const path of paths) assert.equal((await ask('anon', path)).status, 200, `restored ${path}`);
  app.context.galleriesService.trash(as.owner.user, galleryId);
  assert.equal((await ask('admin', PATH_TO.adminShare(shareId, 'revoke'), { method: 'POST' })).status, 303);
  app.context.galleriesService.restore(as.owner.user, galleryId);
  assert.equal((await ask('anon', paths[0])).status, 404);
});

test('ingest job page: a user who neither started the job nor owns the gallery, and is not an admin, gets 404', async () => {
  const stranger = await app.signedIn({ displayName: 'Stranger' });
  const jobs = [
    live.jobId,
    trashed.jobId,
    app.context.ingestJobs.insert({ userId: as.admin.user.id, galleryId: live.galleryId, total: 1 }),
    app.context.ingestJobs.insert({ userId: as.owner.user.id, galleryId: live.galleryId, total: 1 }),
  ];
  for (const jobId of jobs) {
    const page = await app.get(stranger, PATH_TO.ingestJob(jobId));
    assert.equal(page.res.status, 404, `job ${jobId}`);
    assert.doesNotMatch(page.html, /MatrixLive|MatrixTrashed|Adding images/, `job ${jobId}`);
    assert.notEqual((await ask('owner', PATH_TO.ingestJob(jobId))).status, 404, `owner ${jobId}`);
    assert.notEqual((await ask('admin', PATH_TO.ingestJob(jobId))).status, 404, `admin ${jobId}`);
  }
});
