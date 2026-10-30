import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, rowCount } from '../helpers/db.js';
import { createGallerySharesRepository } from '../../db/gallery-shares.repository.js';
import { createGalleriesRepository } from '../../db/galleries.repository.js';
import { createUsersRepository } from '../../db/users.repository.js';
import { insertBareUser } from '../helpers/accounts.js';
import { hashToken } from '../../lib/tokens.js';
import { fakeClock } from '../helpers/clock.js';

function setup() {
  const db = freshDb();
  const userId = insertBareUser(db, { email: 'o@example.com', displayName: 'Olive' });
  const clock = fakeClock('2026-10-28T10:00:00.000Z');
  const galleries = createGalleriesRepository(db, { now: clock.now });
  const galleryId = galleries.insert({ userId });
  const shares = createGallerySharesRepository(db, { now: clock.now });
  return { db, shares, galleries, userId, galleryId, clock };
}

test('insert and liveForGallery store only the token hash', () => {
  const { shares, galleryId } = setup();
  assert.equal(shares.liveForGallery(galleryId), null);
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  const row = shares.liveForGallery(galleryId);
  assert.equal(row.id, id);
  assert.equal(row.gallery_id, galleryId);
  assert.equal(row.nonce, 'n');
  assert.equal(row.created_at, '2026-10-28T10:00:00.000Z');
  assert.equal(shares.byId(id).token_hash, hashToken('t'), 'stores only the hash of the token');
});

test('one live link per gallery; a revoked one does not block a new one', () => {
  const { shares, galleryId, userId } = setup();
  const first = shares.insert({ galleryId, token: 't1', nonce: 'n1' });
  assert.throws(() => shares.insert({ galleryId, token: 't2', nonce: 'n2' }), /UNIQUE constraint failed/);
  shares.revoke(first, userId);
  const second = shares.insert({ galleryId, token: 't2', nonce: 'n2' });
  assert.equal(shares.liveForGallery(galleryId).id, second);
});

test('token_hash is unique across galleries', () => {
  const { shares, galleries, galleryId, userId } = setup();
  const other = galleries.insert({ userId });
  shares.insert({ galleryId, token: 'same', nonce: 'n1' });
  assert.throws(
    () => shares.insert({ galleryId: other, token: 'same', nonce: 'n2' }),
    (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE' && /gallery_shares\.token_hash/.test(error.message),
  );
});

test('revoke clears the nonce and returns false the second time', () => {
  const { shares, galleryId, userId } = setup();
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  assert.equal(shares.revoke(id, userId), true);
  const row = shares.byId(id);
  assert.equal(row.nonce, null);
  assert.equal(row.revoked_by, userId);
  assert.ok(row.revoked_at);
  assert.equal(shares.revoke(id, userId), false);
  assert.equal(shares.liveForGallery(galleryId), null);
});

test('recordView logs the kind, counts page views, stamps from the clock and truncates the user-agent', () => {
  const { shares, galleryId, clock } = setup();
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  clock.set('2026-10-29T08:00:00.000Z');
  shares.recordView(id, { ip: '1.2.3.4', userAgent: 'x'.repeat(300) });
  shares.recordView(id, { ip: '1.2.3.5', userAgent: null, kind: 'page' });
  clock.set('2026-10-29T09:00:00.000Z');
  shares.recordView(id, { ip: '1.2.3.6', kind: 'zip' });
  const row = shares.byId(id);
  assert.equal(row.view_count, 2, 'view_count counts page views only');
  assert.equal(row.last_viewed_at, '2026-10-29T08:00:00.000Z');
  const views = shares.views(id);
  assert.equal(views.length, 3);
  assert.equal(views[0].kind, 'zip', 'newest first');
  assert.equal(views.find((v) => v.ip === '1.2.3.4').kind, 'page', 'page is the default kind');
  assert.equal(views.find((v) => v.ip === '1.2.3.4').user_agent.length, 200);
  assert.throws(() => shares.recordView(id, { kind: 'other' }), /CHECK constraint failed/);
});

test('purgeViewsBefore deletes old rows but leaves view_count', () => {
  const { shares, galleryId, clock } = setup();
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  shares.recordView(id, { ip: 'a' });
  clock.set('2026-12-01T00:00:00.000Z');
  shares.recordView(id, { ip: 'b' });
  assert.equal(shares.purgeViewsBefore('2026-11-01T00:00:00.000Z'), 1);
  assert.deepEqual(
    shares.views(id).map((v) => v.ip),
    ['b'],
  );
  assert.equal(shares.byId(id).view_count, 2);
});

test('byToken hashes the plain token and joins deleted_at, user_id and owner disabled', () => {
  const { db, shares, galleries, galleryId, userId, clock } = setup();
  shares.insert({ galleryId, token: 't', nonce: 'n' });
  let row = shares.byToken('t');
  assert.equal(row.user_id, userId);
  assert.equal(row.deleted_at, null);
  assert.equal(row.owner_disabled, 0);
  clock.set('2026-10-28T11:00:00.000Z');
  galleries.trashOwned(galleryId, userId);
  createUsersRepository(db).setDisabled(userId, true);
  row = shares.byToken('t');
  assert.equal(row.deleted_at, '2026-10-28T11:00:00.000Z');
  assert.equal(row.owner_disabled, 1);
  assert.equal(shares.byToken('nope'), null);
  assert.equal(shares.byToken(hashToken('t')), null, 'the stored hash is not a usable token');
});

test('deleting a gallery deletes its shares and their views', () => {
  const { db, shares, galleryId } = setup();
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  shares.recordView(id, { ip: 'a' });
  db.prepare('DELETE FROM galleries WHERE id = ?').run(galleryId);
  assert.equal(shares.byId(id), null);
  assert.equal(rowCount(db, 'gallery_share_views'), 0);
});

test('listLive, countLive and paging show live shares only, with gallery and owner details', () => {
  const { shares, galleries, userId, galleryId } = setup();
  galleries.updateMeta(galleryId, { title: 'Trip', description: null, allowZip: false, actorId: userId });
  const second = galleries.insert({ userId });
  const a = shares.insert({ galleryId, token: 't1', nonce: 'n' });
  const b = shares.insert({ galleryId: second, token: 't2', nonce: 'n' });
  assert.equal(shares.countLive(), 2);
  const rows = shares.listLive({ limit: 10 });
  assert.deepEqual(
    rows.map((r) => r.id),
    [b, a],
  );
  assert.equal(rows[0].owner_email, 'o@example.com');
  assert.equal(rows[0].owner_name, 'Olive');
  assert.equal(rows[1].title, 'Trip');
  assert.equal(rows[1].gallery_id, galleryId);
  assert.deepEqual(
    shares.listLive({ beforeId: b, limit: 10 }).map((r) => r.id),
    [a],
  );
  assert.deepEqual(
    shares.listLive({ beforeId: String(b), limit: '10' }).map((r) => r.id),
    [a],
    'a string cursor still pages',
  );
  assert.equal(shares.listLive({ limit: 1 }).length, 1);
  shares.revoke(a, userId);
  assert.equal(shares.countLive(), 1);
});

test('liveById joins details for a live share only (a paused one included)', () => {
  const { shares, galleries, userId, galleryId } = setup();
  const id = shares.insert({ galleryId, token: 't', nonce: 'n' });
  const row = shares.liveById(id);
  assert.equal(row.id, id);
  assert.equal(row.gallery_id, galleryId);
  assert.equal(row.owner_email, 'o@example.com');
  assert.equal(row.view_count, 0);
  assert.deepEqual(Object.keys(row).sort(), Object.keys(shares.listLive({ limit: 1 })[0]).sort(), 'same columns');
  galleries.trashOwned(galleryId, userId);
  assert.ok(shares.liveById(id).deleted_at, 'a paused (trashed) share is still live');
  shares.revoke(id, userId);
  assert.equal(shares.liveById(id), null);
  assert.equal(shares.liveById(999999), null);
});

test('liveGalleryIds includes a trashed gallery; countLiveForUser does not; both ignore revoked and other users', () => {
  const { db, shares, galleries, userId, galleryId } = setup();
  const other = insertBareUser(db, { email: 'p@example.com' });
  const otherGallery = galleries.insert({ userId: other });
  const revokedGallery = galleries.insert({ userId });
  shares.insert({ galleryId, token: 't1', nonce: 'n' });
  shares.insert({ galleryId: otherGallery, token: 't2', nonce: 'n' });
  shares.revoke(shares.insert({ galleryId: revokedGallery, token: 't3', nonce: 'n' }), userId);
  galleries.trashOwned(galleryId, userId);
  assert.deepEqual([...shares.liveGalleryIds(userId)], [galleryId]);
  assert.equal(shares.countLiveForUser(userId), 0, 'the trashed gallery link is paused');
  assert.equal(shares.countLiveForUser(other), 1);
  const live = galleries.insert({ userId });
  shares.insert({ galleryId: live, token: 't4', nonce: 'n' });
  assert.equal(shares.countLiveForUser(userId), 1);
});

test('liveAmong picks the galleries with a live link among the given ids, across owners, in one query', () => {
  const { db, shares, galleries, userId, galleryId } = setup();
  const other = insertBareUser(db, { email: 'q@example.com' });
  const theirs = galleries.insert({ userId: other });
  const revoked = galleries.insert({ userId });
  const unshared = galleries.insert({ userId });
  shares.insert({ galleryId, token: 'a1', nonce: 'n' });
  shares.insert({ galleryId: theirs, token: 'a2', nonce: 'n' });
  shares.revoke(shares.insert({ galleryId: revoked, token: 'a3', nonce: 'n' }), userId);
  assert.deepEqual([...shares.liveAmong([galleryId, theirs, revoked, unshared])].sort(), [galleryId, theirs].sort());
  assert.deepEqual([...shares.liveAmong([unshared])], []);
  assert.deepEqual([...shares.liveAmong([])], []);
  galleries.trashOwned(galleryId, userId);
  assert.ok(shares.liveAmong([galleryId]).has(galleryId), 'a trashed gallery link is paused, still live');
});
