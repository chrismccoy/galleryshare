import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, rowCount } from '../helpers/db.js';
import { insertBareUser } from '../helpers/accounts.js';
import { fakeClock } from '../helpers/clock.js';
import { imageRow } from '../helpers/gallery-seed.js';
import { MS_PER_HOUR } from '../../lib/time.js';
import { createGalleriesRepository } from '../../db/galleries.repository.js';
import { createGalleryImagesRepository } from '../../db/gallery-images.repository.js';

const MINUTE = 60_000;

function setup() {
  const db = freshDb();
  const { now, tick } = fakeClock('2026-01-01T00:00:00Z');
  const galleries = createGalleriesRepository(db, { now });
  const images = createGalleryImagesRepository(db, { now });
  const owner = insertBareUser(db, { email: 'o@x.co' });
  const other = insertBareUser(db, { email: 'p@x.co' });
  let n = 0;
  const img = (galleryId, extra = {}) =>
    images.insert(
      imageRow(galleryId, {
        publicName: `name${String(++n).padStart(6, '0')}`,
        originalName: 'a.jpg',
        bytesOrig: 100,
        bytesWeb: 10,
        bytesThumb: 1,
        ...extra,
      }),
    );
  return { db, galleries, images, owner, other, img, tick };
}

const order = (images, g) => images.forGallery(g).map((r) => r.id);

test('images: positions, remove renumbers, reorder', () => {
  const { galleries, images, owner, img } = setup();
  const g = galleries.insert({ userId: owner });
  const [a, b, c] = [img(g), img(g), img(g)];
  assert.deepEqual(
    images.forGallery(g).map((r) => r.position),
    [1, 2, 3],
  );
  assert.equal(images.count(g), 3);
  assert.equal(images.remove(b).id, b);
  assert.equal(images.remove(b), null);
  assert.deepEqual(
    images.forGallery(g).map((r) => [r.id, r.position]),
    [
      [a, 1],
      [c, 2],
    ],
  );
  assert.equal(images.reorder(g, [c, a]), true);
  assert.deepEqual(order(images, g), [c, a]);
  assert.equal(images.reorder(g, [a]), false);
  assert.equal(images.reorder(g, [a, a]), false);
  assert.equal(images.reorder(g, [a, b]), false);
  assert.deepEqual(order(images, g), [c, a]);
  images.update(a, { title: 'T', caption: 'C' });
  assert.equal(images.byId(a).title, 'T');
  assert.equal(images.byId(a).caption, 'C');
  const row = images.byId(a);
  assert.equal(images.byPublicName(g, row.public_name).id, a);
  assert.equal(images.byPublicName(g + 1, row.public_name), null);
});

test('galleries: forUser lists newest first with image counts, bytes and the first image as cover, and pages', () => {
  const { galleries, images, owner, other, img, tick } = setup();
  const g1 = galleries.insert({ userId: owner });
  tick(1000);
  const g2 = galleries.insert({ userId: owner });
  const x = img(g1);
  img(g1);
  images.reorder(g1, [images.forGallery(g1)[1].id, x]);
  const rows = galleries.forUser(owner);
  assert.deepEqual(
    rows.map((r) => r.id),
    [g2, g1],
  );
  assert.equal(rows[0].image_count, 0);
  assert.equal(rows[0].thumb_image_id, null);
  assert.equal(rows[0].bytes, 0);
  assert.equal(rows[1].image_count, 2);
  assert.equal(rows[1].bytes, 222);
  assert.equal(rows[1].thumb_image_id, images.forGallery(g1)[0].id, 'the cover follows the order');
  assert.deepEqual(
    galleries.forUser(owner, { beforeId: g2 }).map((r) => r.id),
    [g1],
  );
  assert.equal(galleries.forUser(owner, { limit: 1 }).length, 1);
  assert.equal(galleries.forUser(other).length, 0);
});

test('galleries: updateMeta stores the details, the grid text column and who edited, stamped from the clock', () => {
  const { galleries, owner, other, tick } = setup();
  const g1 = galleries.insert({ userId: owner });
  tick(2000);
  galleries.updateMeta(g1, { title: 'Trip', description: 'd', allowZip: true, actorId: other });
  const m = galleries.liveById(g1);
  assert.deepEqual([m.title, m.description, m.allow_zip, m.updated_by], ['Trip', 'd', 1, other]);
  assert.equal(m.grid_text, null, 'no grid text choice: the site setting');
  galleries.updateMeta(g1, { title: 'Trip', description: 'd', allowZip: true, gridText: 0, actorId: other });
  assert.equal(galleries.liveById(g1).grid_text, 0);
  galleries.updateMeta(g1, { title: 'Trip', description: 'd', allowZip: true, gridText: 1, actorId: other });
  assert.equal(galleries.liveById(g1).grid_text, 1);
  galleries.updateMeta(g1, { title: 'Trip', description: 'd', allowZip: true, actorId: other });
  assert.equal(galleries.liveById(g1).updated_at, '2026-01-01T00:00:02.000Z', 'every update stamps the clock time');
});

test('galleries: markEdited stamps the time and the editor', () => {
  const { galleries, owner, tick } = setup();
  const g1 = galleries.insert({ userId: owner });
  tick(3000);
  galleries.markEdited(g1, owner);
  const row = galleries.liveById(g1);
  assert.equal(row.updated_at, '2026-01-01T00:00:03.000Z');
  assert.equal(row.updated_by, owner);
});

test("galleries: listLive joins the owner and filters by owner; idsForUser lists one owner's ids", () => {
  const { galleries, owner, other } = setup();
  const g1 = galleries.insert({ userId: owner });
  const g2 = galleries.insert({ userId: owner });
  const all = galleries.listLive({});
  assert.equal(all.length, 2);
  assert.equal(all[0].owner_email, 'o@x.co');
  assert.ok('owner_name' in all[0]);
  assert.equal(galleries.listLive({ userId: other }).length, 0);
  assert.deepEqual(galleries.idsForUser(owner).sort(), [g1, g2]);
});

test('galleries: trash, restore, purge', () => {
  const { galleries, owner, other, tick } = setup();
  const a = galleries.insert({ userId: owner });
  const b = galleries.insert({ userId: owner });
  const c = galleries.insert({ userId: owner });
  assert.equal(galleries.trashOwned(a, other), false);
  assert.equal(galleries.trashOwned(a, owner), true);
  assert.equal(galleries.trashOwned(a, owner), false);
  assert.equal(galleries.liveById(a), null);
  assert.ok(galleries.byIdIncludingTrashed(a).deleted_at);
  assert.equal(galleries.forUser(owner).length, 2);
  assert.equal(galleries.countTrashed(owner), 1);
  assert.deepEqual(
    galleries.trashedForUser(owner).map((r) => r.id),
    [a],
  );
  assert.equal(galleries.restoreOwned(a, other), false);
  assert.equal(galleries.restoreOwned(a, owner), true);
  assert.equal(galleries.restoreOwned(a, owner), false);
  assert.equal(galleries.trashById(b), true);
  assert.equal(galleries.trashById(b), false);
  tick(MINUTE);
  galleries.trashOwned(c, owner);
  assert.deepEqual(
    galleries.trashedForUser(owner).map((r) => r.id),
    [c, b],
  );
  assert.deepEqual(
    galleries.trashedForUser(owner, { beforeId: c }).map((r) => r.id),
    [b],
  );
  assert.equal(galleries.purgeOwned(a, owner), false, 'live gallery not purged');
  assert.equal(galleries.purgeOwned(b, other), false);
  assert.equal(galleries.purgeOwned(b, owner), true);
  assert.equal(galleries.byIdIncludingTrashed(b), null);
  assert.deepEqual(galleries.emptyTrash(owner), [c]);
  assert.deepEqual(galleries.emptyTrash(owner), []);
});

test('galleries: purgeTrashedBefore returns ids; purge cascades images', () => {
  const { db, galleries, images, owner, img, tick } = setup();
  const old = galleries.insert({ userId: owner });
  const recent = galleries.insert({ userId: owner });
  img(old);
  galleries.trashOwned(old, owner);
  tick(MS_PER_HOUR);
  galleries.trashOwned(recent, owner);
  assert.deepEqual(galleries.purgeTrashedBefore('2026-01-01T00:30:00.000Z'), [old]);
  assert.equal(rowCount(db, 'gallery_images'), 0);
  assert.equal(images.count(old), 0);
  assert.deepEqual(galleries.purgeTrashedBefore('2027-01-01T00:00:00.000Z'), [recent]);
  assert.deepEqual(galleries.purgeTrashedBefore('2027-01-01T00:00:00.000Z'), []);
});

test('galleries: stats, bytesForUser, largest', () => {
  const { galleries, owner, other, img } = setup();
  assert.deepEqual(galleries.stats(), { galleries: 0, images: 0, avgImages: 0, bytes: 0, trashed: 0 });
  const g1 = galleries.insert({ userId: owner });
  const g2 = galleries.insert({ userId: other });
  img(g1);
  img(g1);
  img(g1);
  img(g2);
  assert.deepEqual(galleries.stats(), { galleries: 2, images: 4, avgImages: 2, bytes: 444, trashed: 0 });
  const g3 = galleries.insert({ userId: owner });
  img(g3);
  img(g3);
  assert.equal(galleries.stats().avgImages, 2, 'rounded to 1 decimal: 6/3');
  galleries.trashOwned(g3, owner);
  assert.deepEqual(galleries.stats(), { galleries: 2, images: 4, avgImages: 2, bytes: 444, trashed: 1 });
  assert.equal(galleries.bytesForUser(owner), 555);
  assert.equal(galleries.bytesForUser(other), 111);
  assert.equal(galleries.bytesForUser(9999), 0);
  const big = galleries.largest(1);
  assert.equal(big.length, 1);
  assert.equal(big[0].id, g1);
  assert.deepEqual([big[0].image_count, big[0].bytes], [3, 333]);
  assert.ok('owner_name' in big[0] && 'title' in big[0]);
  assert.equal(galleries.largest().length, 2, 'trashed excluded');
});

test('stats avgImages rounds to one decimal', () => {
  const { galleries, owner, img } = setup();
  const a = galleries.insert({ userId: owner });
  galleries.insert({ userId: owner });
  galleries.insert({ userId: owner });
  img(a);
  assert.equal(galleries.stats().avgImages, 0.3);
});

test('images: setBytes updates the byte columns', () => {
  const { galleries, images, owner, img } = setup();
  const g = galleries.insert({ userId: owner });
  const a = img(g, { bytesOrig: 0, bytesWeb: 0, bytesThumb: 0 });
  assert.equal(images.setBytes(a, { bytesOrig: 7, bytesWeb: 5, bytesThumb: 3 }), true);
  const row = images.byId(a);
  assert.deepEqual([row.bytes_orig, row.bytes_web, row.bytes_thumb], [7, 5, 3]);
  assert.equal(images.setBytes(9999, { bytesOrig: 1, bytesWeb: 1, bytesThumb: 1 }), false);
});

test("images: insert stores the perceptual hash, and phashes lists a gallery's hashes", () => {
  const { galleries, images, owner, img } = setup();
  const g = galleries.insert({ userId: owner });
  const other = galleries.insert({ userId: owner });
  const a = img(g, { phash: '00000000000000ff' });
  img(g);
  img(other, { phash: 'ffffffffffffffff' });
  assert.equal(images.byId(a).phash, '00000000000000ff');
  assert.deepEqual(images.phashes(g), ['00000000000000ff'], 'only this gallery, rows without a hash left out');
});

test('images: withoutPhash lists written rows with no hash, oldest first; setPhash fills one', () => {
  const { galleries, images, owner, img } = setup();
  const g = galleries.insert({ userId: owner });
  const a = img(g);
  img(g, { phash: '0000000000000001' });
  img(g, { bytesOrig: 0, bytesWeb: 0, bytesThumb: 0 });
  const b = img(g);
  assert.deepEqual(
    images.withoutPhash(10).map((r) => r.id),
    [a, b],
    'hashed and unwritten rows are skipped',
  );
  assert.deepEqual(
    images.withoutPhash(1).map((r) => r.id),
    [a],
    'at most `limit` rows',
  );
  assert.equal(images.setPhash(a, '00000000000000aa'), true);
  assert.equal(images.byId(a).phash, '00000000000000aa');
  assert.deepEqual(
    images.withoutPhash(10).map((r) => r.id),
    [b],
  );
  assert.equal(images.setPhash(9999, '00000000000000aa'), false);
});

test('images: withoutPhash starts after the given id', () => {
  const { galleries, images, owner, img } = setup();
  const g = galleries.insert({ userId: owner });
  const [a, b, c] = [img(g), img(g), img(g)];
  assert.deepEqual(
    images.withoutPhash(10, a).map((r) => r.id),
    [b, c],
  );
  assert.deepEqual(images.withoutPhash(10, c), []);
});

test('galleries.backdate sets created_at and updated_at, for the demo seed', () => {
  const { galleries, owner } = setup();
  const id = galleries.insert({ userId: owner });
  assert.equal(galleries.backdate(id, '2025-05-05T00:00:00.000Z'), true);
  const row = galleries.byIdIncludingTrashed(id);
  assert.equal(row.created_at, '2025-05-05T00:00:00.000Z');
  assert.equal(row.updated_at, '2025-05-05T00:00:00.000Z');
  assert.equal(galleries.backdate(id + 99, '2025-05-05T00:00:00.000Z'), false, 'no such gallery');
});

test('countLive counts live galleries of one owner or of everyone, never the Trash', () => {
  const db = freshDb();
  const galleries = createGalleriesRepository(db);
  const a = insertBareUser(db, { email: 'count-a@example.com' });
  const b = insertBareUser(db, { email: 'count-b@example.com' });
  galleries.insert({ userId: a });
  const trashed = galleries.insert({ userId: a });
  galleries.insert({ userId: b });
  galleries.trashOwned(trashed, a);
  assert.equal(galleries.countLive(a), 1);
  assert.equal(galleries.countLive(b), 1);
  assert.equal(galleries.countLive(), 2);
  assert.equal(galleries.countLive(null), 2);
});
