import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../helpers/context.js';
import { insertBareUserRow } from '../helpers/accounts.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { createSharesService } from '../../services/shares.service.js';
import { withSettings } from '../helpers/settings.js';
import { shareToken } from '../../domain/share-links.js';
import { hashToken } from '../../lib/tokens.js';
import { NotFoundError, SharingOffError } from '../../lib/errors.js';
import { activityLog } from '../helpers/activity.js';

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function setup() {
  const { db, context } = buildContext();
  const owner = insertBareUserRow(context, { email: 'owner@example.com' });
  const other = insertBareUserRow(context, { email: 'other@example.com' });
  const admin = insertBareUserRow(context, { email: 'admin@example.com', role: 'admin' });
  const galleryId = seedGallery(context, owner.id, { title: 'Trip', images: 2 });
  return { db, context, service: context.sharesService, owner, other, admin, galleryId };
}

function serviceWith(context, overrides) {
  const { shares, galleriesService, settingsService, secret } = context;
  return createSharesService({
    shares,
    galleriesService,
    settingsService,
    secret,
    ...overrides,
  });
}

function rotatedService(db) {
  return buildContext({ db, secret: 'a different secret' }).context.sharesService;
}

test('share creates once and reuses the live link (re-sharing returns the same link)', () => {
  const { context, service, owner, galleryId } = setup();
  const first = service.share(owner, galleryId);
  assert.match(first.token, /^[0-9A-Za-z]{7}$/);
  assert.ok(first.createdAt);
  assert.deepEqual(service.share(owner, galleryId), first, 'same token and date');
  assert.equal(context.shares.countLive(), 1);
  assert.deepEqual(service.linkFor(owner, galleryId), first);
  assert.deepEqual(service.liveGalleryIds(owner.id), new Set([galleryId]));
  assert.equal(service.countLiveForUser(owner.id), 1);
  assert.equal(service.resolve(first.token).gallery.id, galleryId);

  assert.equal(service.revokeFor(owner, galleryId), undefined);
  assert.throws(() => service.revokeFor(owner, galleryId), NotFoundError, 'nothing left to revoke');
  assert.equal(service.linkFor(owner, galleryId), null);
  assert.equal(service.resolve(first.token), null, 'old link is dead');

  const next = service.share(owner, galleryId);
  assert.notEqual(next.token, first.token);
  assert.equal(service.resolve(first.token), null, 'old link stays dead');
  assert.equal(service.resolve(next.token).gallery.id, galleryId);
});

test('share() retries on a token_hash collision with a new nonce', () => {
  const { context, owner, galleryId } = setup();
  const otherGallery = seedGallery(context, owner.id, { images: 1 });
  const nonces = ['taken', 'taken', 'fresh'];
  const service = serviceWith(context, {
    newNonce: () => nonces.shift(),
  });
  const first = service.share(owner, otherGallery);
  assert.equal(first.token, shareToken(context.secret, 'taken'));
  const second = service.share(owner, galleryId);
  assert.equal(second.token, shareToken(context.secret, 'fresh'), 'the colliding nonce was replaced');
  assert.equal(nonces.length, 0);
  assert.equal(context.shares.liveForGallery(galleryId).nonce, 'fresh');
  assert.equal(service.resolve(second.token).gallery.id, galleryId);
  assert.equal(service.resolve(first.token).gallery.id, otherGallery);
});

test('share() gives up after 5 colliding attempts and stores nothing', () => {
  const { context, owner, galleryId } = setup();
  const otherGallery = seedGallery(context, owner.id);
  let calls = 0;
  const service = serviceWith(context, {
    newNonce: () => {
      calls += 1;
      return 'always';
    },
  });
  service.share(owner, otherGallery);
  calls = 0;
  assert.throws(() => service.share(owner, galleryId), /UNIQUE constraint failed: gallery_shares\.token_hash/);
  assert.equal(calls, 5);
  assert.equal(context.shares.liveForGallery(galleryId), null);
});

test('an admin can share and revoke any gallery; another user cannot, nor a trashed or missing one', () => {
  const { context, service, owner, other, admin, galleryId } = setup();
  assert.throws(() => service.share(other, galleryId), NotFoundError);
  assert.throws(() => service.share(owner, 999999), NotFoundError);
  assert.throws(() => service.share(null, galleryId), NotFoundError);

  const shared = service.share(admin, galleryId);
  assert.deepEqual(service.linkFor(admin, galleryId), shared);
  assert.deepEqual(service.linkFor(owner, galleryId), shared, 'the owner sees the link an admin made');
  assert.equal(service.linkFor(other, galleryId), null);
  assert.throws(() => service.revokeFor(other, galleryId), NotFoundError);
  assert.ok(service.resolve(shared.token), 'still live');
  const shareId = context.shares.liveForGallery(galleryId).id;
  service.revokeFor(admin, galleryId);
  assert.equal(context.shares.byId(shareId).revoked_by, admin.id);

  context.galleries.trashOwned(galleryId, owner.id);
  assert.throws(() => service.share(owner, galleryId), NotFoundError);
  assert.equal(context.shares.countLive(), 0);
});

test('a paused link (gallery in Trash) can still be seen and revoked by the owner and admins, not by others', () => {
  const { context, service, owner, other, admin, galleryId } = setup();
  const shared = service.share(owner, galleryId);
  context.galleriesService.trash(owner, galleryId);
  assert.equal(service.resolve(shared.token), null, 'paused');
  assert.deepEqual(service.linkFor(owner, galleryId), shared);
  assert.deepEqual(service.linkFor(admin, galleryId), shared);
  assert.equal(service.linkFor(other, galleryId), null);
  assert.throws(() => service.revokeFor(other, galleryId), NotFoundError);
  service.revokeFor(admin, galleryId);
  assert.equal(service.linkFor(owner, galleryId), null);
});

test('share refuses with SharingOffError (403) while the master switch is off', (t) => {
  const { context, service, owner, galleryId } = setup();
  withSettings(t, context, { publicSharing: false });
  assert.throws(
    () => service.share(owner, galleryId),
    (error) =>
      error instanceof SharingOffError &&
      error.publicStatus === 403 &&
      error.publicMessage === 'Sharing is turned off.',
  );
  assert.equal(context.shares.countLive(), 0);
});

test('resolve: pause rules (trash, disabled owner, switch off), bad shapes and unknown tokens', (t) => {
  const { context, service, owner, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const live = service.resolve(token);
  assert.equal(live.gallery.id, galleryId);
  assert.equal(live.share.id, context.shares.liveForGallery(galleryId).id);
  assert.deepEqual(
    live.images.map((i) => i.position),
    [1, 2],
  );

  context.galleries.trashOwned(galleryId, owner.id);
  assert.equal(service.resolve(token), null, 'trashed');
  context.galleries.restoreOwned(galleryId, owner.id);
  assert.ok(service.resolve(token), 'restored: same token works');

  context.users.setDisabled(owner.id, true);
  assert.equal(service.resolve(token), null, 'owner disabled');
  context.users.setDisabled(owner.id, false);
  assert.ok(service.resolve(token), 'owner enabled');

  const setSettings = withSettings(t, context);
  setSettings({ publicSharing: false });
  assert.equal(service.resolve(token), null, 'switch off');
  setSettings({ publicSharing: true });
  assert.ok(service.resolve(token), 'switch on');

  for (const bad of ['nope', `${token}x`, token.slice(1), undefined, null, 42, '1234567']) {
    assert.equal(service.resolve(bad), null, String(bad));
  }
  assert.equal(context.shares.liveForGallery(galleryId).view_count, 0, 'resolve never records a view');
});

test('resolveImage finds an image of the shared gallery by public name, under the same rules', () => {
  const { context, service, owner, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const [image] = context.galleryImages.forGallery(galleryId);
  const otherGallery = seedGallery(context, owner.id, { images: 1 });
  const [foreign] = context.galleryImages.forGallery(otherGallery);

  assert.equal(service.resolveImage(token, image.public_name).image.id, image.id);
  assert.equal(service.resolveImage(token, image.public_name).gallery.id, galleryId);
  assert.equal(service.resolveImage(token, foreign.public_name), null, 'image of another gallery');
  assert.equal(service.resolveImage(token, 'nope'), null);
  assert.equal(service.resolveImage('abcdefg', image.public_name), null);
  context.galleries.trashOwned(galleryId, owner.id);
  assert.equal(service.resolveImage(token, image.public_name), null, 'trashed');
});

test('recordView: not counted for the owner, admins or bots; anonymous and other users are', () => {
  const { context, service, owner, other, admin, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const { share } = service.resolve(token);
  const row = () => context.shares.liveForGallery(galleryId);
  const view = (extra) =>
    service.recordView(share.id, { ip: '1.1.1.1', userAgent: CHROME, ownerId: owner.id, ...extra });

  assert.equal(view({ viewer: owner }), false);
  assert.equal(view({ viewer: admin }), false);
  assert.equal(view({ userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' }), false);
  assert.equal(row().view_count, 0);
  assert.deepEqual(context.shares.views(share.id), []);

  assert.equal(view({ ip: '203.0.113.7' }), true);
  assert.equal(row().view_count, 1);
  const [logged] = context.shares.views(share.id);
  assert.equal(logged.ip, '203.0.113.7');
  assert.equal(logged.user_agent, CHROME);
  assert.equal(logged.kind, 'page');

  assert.equal(view({ viewer: other }), true, 'another signed-in user is a normal visitor');
  assert.equal(view({ kind: 'zip' }), true);
  assert.equal(context.shares.views(share.id)[0].kind, 'zip');
  assert.equal(row().view_count, 2, 'a zip download is logged but not a page view');
});

test('rotated secret keeps links working but refuses to re-show', () => {
  const { db, context, service, owner, galleryId } = setup();
  const { token, createdAt } = service.share(owner, galleryId);
  const rotated = rotatedService(db);
  assert.equal(rotated.resolve(token).gallery.id, galleryId);
  assert.deepEqual(rotated.linkFor(owner, galleryId), { token: null, createdAt });
  assert.deepEqual(rotated.share(owner, galleryId), { token: null, createdAt }, 'never hands out a dead link');
  assert.equal(context.shares.liveForGallery(galleryId).token_hash, hashToken(token));
});

test('admin revoke, list, detail and count', () => {
  const { context, service, owner, admin, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const shareId = context.shares.liveForGallery(galleryId).id;
  service.recordView(shareId, { ip: '5.5.5.5', userAgent: CHROME, ownerId: owner.id });

  assert.equal(service.countLive(), 1);
  const [row] = service.listLive({ limit: 10 });
  assert.equal(row.id, shareId);
  assert.equal(row.owner_email, 'owner@example.com');
  assert.equal(row.title, 'Trip');
  const detail = service.detail(shareId);
  assert.equal(detail.share.id, shareId);
  assert.equal(detail.share.owner_email, 'owner@example.com', 'owner details joined');
  assert.equal(detail.views.length, 1);
  assert.equal(detail.views[0].ip, '5.5.5.5');
  assert.equal(detail.views[0].kind, 'page');
  assert.equal(service.detail(999999), null);

  assert.equal(service.revoke(shareId, admin.id), undefined);
  assert.throws(() => service.revoke(shareId, admin.id), NotFoundError, 'already revoked');
  assert.equal(context.shares.byId(shareId).revoked_by, admin.id);
  assert.equal(service.countLive(), 0);
  assert.equal(service.resolve(token), null);
  assert.equal(service.detail(shareId), null, 'no detail for a revoked link');
});

test('tokenForShare gives an admin the public token of a live link only', () => {
  const { db, context, service, owner, admin, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const shareId = context.shares.liveForGallery(galleryId).id;
  assert.equal(service.tokenForShare(shareId), token);
  assert.equal(service.tokenForShare(999999), null);
  assert.equal(rotatedService(db).tokenForShare(shareId), null, 'a link that cannot be derived has no token');
  service.revoke(shareId, admin.id);
  assert.equal(service.tokenForShare(shareId), null);
});

const sharingEvents = (context) => activityLog(context, { area: 'sharing' });

test('activity: linkShared once per new link, with the owner as subject when an admin shares', () => {
  const { context, service, owner, admin, galleryId } = setup();
  service.share(owner, galleryId);
  service.share(owner, galleryId);
  let events = sharingEvents(context);
  assert.equal(events.length, 1, 're-sharing records nothing');
  assert.equal(events[0].kind, 'linkShared');
  assert.equal(events[0].actor_id, owner.id);
  assert.equal(events[0].subject_user_id, null);
  assert.equal(events[0].gallery_id, galleryId);
  assert.equal(events[0].gallery_title, 'Trip');

  service.revokeFor(owner, galleryId);
  const other = seedGallery(context, owner.id, { title: 'Other', images: 1 });
  service.share(admin, other);
  events = sharingEvents(context);
  const shared = events.at(-1);
  assert.equal(shared.kind, 'linkShared');
  assert.equal(shared.actor_id, admin.id);
  assert.equal(shared.subject_user_id, owner.id);
});

test('activity: linkRevoked by the owner, by an admin via revokeFor and via revoke(shareId)', () => {
  const { context, service, owner, admin, galleryId } = setup();
  service.share(owner, galleryId);
  service.revokeFor(owner, galleryId);
  service.share(owner, galleryId);
  service.revokeFor(admin, galleryId);
  service.share(owner, galleryId);
  service.revoke(context.shares.liveForGallery(galleryId).id, admin.id);
  const revoked = sharingEvents(context).filter((e) => e.kind === 'linkRevoked');
  assert.equal(revoked.length, 3);
  assert.equal(revoked[0].actor_id, owner.id);
  assert.equal(revoked[0].subject_user_id, null);
  for (const e of revoked.slice(1)) {
    assert.equal(e.actor_id, admin.id);
    assert.equal(e.subject_user_id, owner.id);
    assert.equal(e.gallery_title, 'Trip');
  }
  assert.throws(() => service.revoke(999999, admin.id), NotFoundError);
  assert.equal(
    sharingEvents(context).filter((e) => e.kind === 'linkRevoked').length,
    3,
    'failed revoke records nothing',
  );
});

test('activity: visits and ZIP downloads are recorded exactly when a view row is written, without the token', () => {
  const { context, service, owner, other, admin, galleryId } = setup();
  const { token } = service.share(owner, galleryId);
  const { share } = service.resolve(token);
  const view = (extra) =>
    service.recordView(share.id, { ip: '203.0.113.7', userAgent: CHROME, ownerId: owner.id, ...extra });
  view({ viewer: owner });
  view({ viewer: admin });
  view({ userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
  assert.equal(sharingEvents(context).filter((e) => e.kind !== 'linkShared').length, 0);

  view();
  view({ kind: 'zip', viewer: other });
  const [visit, zip] = sharingEvents(context).filter((e) => e.kind !== 'linkShared');
  assert.equal(visit.kind, 'galleryVisited');
  assert.equal(zip.kind, 'zipDownloaded');
  for (const e of [visit, zip]) {
    assert.equal(e.actor_type, 'visitor');
    assert.equal(e.subject_user_id, owner.id);
    assert.equal(e.gallery_id, galleryId);
    assert.equal(e.gallery_title, 'Trip');
    assert.equal(e.ip, '203.0.113.7');
    assert.equal(e.user_agent, CHROME);
    assert.ok(!JSON.stringify(e).includes(token), 'no token');
  }
});
