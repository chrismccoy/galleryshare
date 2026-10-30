import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_MB } from '../../lib/size.js';
import fs from 'node:fs';
import path from 'node:path';
import { mediaContext } from '../helpers/context.js';
import { insertBareUserRow } from '../helpers/accounts.js';
import { recordingLogger } from '../helpers/logger.js';
import { fakeClock } from '../helpers/clock.js';
import { isPublicError } from '../helpers/assertions.js';
import { makeJpeg } from '../helpers/images.js';
import { MS_PER_DAY } from '../../lib/time.js';
import { MAX_CAPTION, MAX_DESCRIPTION, MAX_TITLE } from '../../domain/limits.js';
import { processImage } from '../../media/image.js';
import { dhash } from '../../media/phash.js';
import { editedByAdmin } from '../../domain/gallery.js';
import { createGalleriesService } from '../../services/galleries.service.js';
import { ConflictError, LimitExceededError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { activityLog } from '../helpers/activity.js';
import { FOLLOW_SITE } from '../../domain/gallery-choice.js';
import { SHARE_THEME_CHOICE } from '../../domain/share-themes.js';
import { IMAGE_VIEW_CHOICE } from '../../domain/image-views.js';
const DEFAULT_LIMITS = {
  maxImageMb: 25,
  maxZipUploadMb: 500,
  maxImagesPerGallery: 500,
  userQuotaMb: 0,
  maxUploadBatchMb: 1000,
};

function serviceWith(context, overrides) {
  const { galleries, galleryImages, ingestJobs, mediaStore, effectiveConfigService, logger } = context;
  return createGalleriesService({
    galleries,
    galleryImages,
    ingestJobs,
    mediaStore,
    effectiveConfigService,
    logger,
    ...overrides,
  });
}

let fixture;
let clock;
let logged;
let warned;
let processedCache;
beforeEach(async (t) => {
  const recording = recordingLogger();
  clock = fakeClock();
  logged = recording.error;
  warned = recording.warn;
  const { media: dir, db, context } = mediaContext(t, { prefix: 'gs-gal-', logger: recording.logger, now: clock.now });
  const mediaStore = context.mediaStore;
  const limits = { ...DEFAULT_LIMITS };
  const service = serviceWith(context, {
    effectiveConfigService: {
      limitValues: () => ({ ...limits }),
    },
  });
  processedCache ??= await processImage(await makeJpeg({ width: 120, height: 90 }));
  fixture = {
    db,
    dir,
    context,
    mediaStore,
    limits,
    service,
    owner: insertBareUserRow(context, { email: 'o@x.co' }),
    other: insertBareUserRow(context, { email: 'p@x.co' }),
    admin: insertBareUserRow(context, { email: 'a@x.co', role: 'admin' }),
  };
});

const add = (galleryId, name = 'a.jpg') =>
  fixture.service.addProcessedImage(galleryId, { originalName: name, processed: distinctProcessed() });

let hashTurn = 0n;
function distinctProcessed() {
  hashTurn += 1n;
  const phash = ((hashTurn * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn).toString(16).padStart(16, '0');
  return { ...processedCache, phash };
}
const dirOf = (id) => path.join(fixture.dir, String(id));
const throwsNotFound = (fn, message) => assert.throws(fn, NotFoundError, message);

test('owner and admin can edit; another user gets NotFoundError', () => {
  const id = fixture.service.create(fixture.owner);
  assert.equal(fixture.service.getForEdit(fixture.owner, id).gallery.id, id);
  assert.equal(fixture.service.getForEdit(fixture.admin, id).gallery.id, id);
  throwsNotFound(() => fixture.service.getForEdit(fixture.other, id));
  throwsNotFound(() => fixture.service.getForEdit(fixture.owner, 9999));
  fixture.service.trash(fixture.owner, id);
  throwsNotFound(() => fixture.service.getForEdit(fixture.owner, id));
});

test('canManage and getManageable: the owner and admins, never another user or nobody; Trash only when asked', () => {
  const id = fixture.service.create(fixture.owner);
  const { owner, other, admin } = fixture;
  for (const includeTrashed of [false, true]) {
    assert.equal(fixture.service.canManage(owner, id, { includeTrashed }), true);
    assert.equal(fixture.service.canManage(admin, id, { includeTrashed }), true);
    assert.equal(fixture.service.canManage(other, id, { includeTrashed }), false);
    assert.equal(fixture.service.canManage(null, id, { includeTrashed }), false);
    assert.equal(fixture.service.canManage(undefined, id, { includeTrashed }), false);
    assert.equal(fixture.service.canManage(owner, 9999, { includeTrashed }), false);
  }
  assert.equal(fixture.service.getManageable(owner, id).id, id);
  assert.equal(fixture.service.getManageable(admin, id).id, id);
  assert.equal(fixture.service.getManageable(other, id), null);
  assert.equal(fixture.service.canManage(owner, id), true, 'live by default');

  fixture.service.trash(owner, id);
  assert.equal(fixture.service.canManage(owner, id), false, 'Trash is excluded by default');
  assert.equal(fixture.service.canManage(admin, id), false);
  assert.equal(fixture.service.getManageable(owner, id), null);
  assert.equal(fixture.service.canManage(owner, id, { includeTrashed: true }), true);
  assert.equal(fixture.service.canManage(admin, id, { includeTrashed: true }), true);
  assert.equal(fixture.service.canManage(other, id, { includeTrashed: true }), false);
  assert.equal(fixture.service.getManageable(admin, id, { includeTrashed: true }).id, id);
});

test('imageForViewer finds an image for the owner and admins (Trash included), never for another user', async () => {
  const id = fixture.service.create(fixture.owner);
  const imageId = await add(id);
  const { owner, other, admin } = fixture;
  for (const user of [owner, admin]) {
    const found = fixture.service.imageForViewer(user, imageId);
    assert.equal(found.image.id, imageId);
    assert.equal(found.gallery.id, id);
  }
  assert.equal(fixture.service.imageForViewer(other, imageId), null);
  assert.equal(fixture.service.imageForViewer(null, imageId), null);
  assert.equal(fixture.service.imageForViewer(owner, 999999), null);
  assert.equal(fixture.service.imageForViewer(owner, null), null);
  fixture.service.trash(owner, id);
  assert.equal(fixture.service.imageForViewer(owner, imageId).gallery.id, id);
  assert.equal(fixture.service.imageForViewer(admin, imageId).gallery.id, id);
  assert.equal(fixture.service.imageForViewer(other, imageId), null);
});

test('imagesHeldOrReserved adds the images of unfinished jobs to the stored ones', async () => {
  const id = fixture.service.create(fixture.owner);
  await add(id);
  await add(id, 'b.jpg');
  assert.equal(fixture.service.imagesHeldOrReserved(id), 2);
  const jobId = fixture.context.ingestJobs.insert({ userId: fixture.owner.id, galleryId: id, total: 5 });
  assert.equal(fixture.service.imagesHeldOrReserved(id), 7);
  fixture.context.ingestJobs.setFailed(jobId, 'Stopped.');
  assert.equal(fixture.service.imagesHeldOrReserved(id), 2);
});

test('the list and count reads answer per owner: live, Trash, all owners, dashboard totals', async () => {
  const { owner, other } = fixture;
  const live = fixture.service.create(owner);
  await add(live);
  const trashed = fixture.service.create(owner);
  fixture.service.trash(owner, trashed);
  const theirs = fixture.service.create(other);
  assert.deepEqual(
    fixture.service.listForUser(owner.id).map((row) => row.id),
    [live],
  );
  assert.deepEqual(
    fixture.service.listTrash(owner.id).map((row) => row.id),
    [trashed],
  );
  assert.deepEqual(fixture.service.listTrash(other.id), []);
  assert.deepEqual(
    fixture.service.listAll({}).map((row) => row.id),
    [theirs, live],
  );
  assert.deepEqual(
    fixture.service.listAll({ userId: other.id }).map((row) => row.id),
    [theirs],
  );
  assert.equal(fixture.service.countTrashed(owner.id), 1);
  assert.equal(fixture.service.countTrashed(other.id), 0);
  const totals = fixture.service.dashboardTotals(owner.id);
  assert.equal(totals.galleries, 1);
  assert.equal(totals.images, 1);
  assert.ok(totals.bytes > 0);
  assert.deepEqual(fixture.service.dashboardTotals(other.id), { galleries: 1, images: 0, bytes: 0 });
  assert.equal(fixture.service.findLive(live).id, live);
  assert.equal(fixture.service.findLive(trashed), null);
});

test('admin edit sets updated_by and editedByAdmin() is true', () => {
  const id = fixture.service.create(fixture.owner);
  assert.equal(editedByAdmin(fixture.context.galleries.liveById(id)), false);
  fixture.service.saveEdits(fixture.admin, id, { meta: { title: 'T', description: '', allowZip: true }, images: [] });
  const g = fixture.context.galleries.liveById(id);
  assert.equal(g.updated_by, fixture.admin.id);
  assert.equal(editedByAdmin(g), true);
  fixture.service.saveEdits(fixture.owner, id, { meta: { title: 'T', description: '', allowZip: true }, images: [] });
  assert.equal(editedByAdmin(fixture.context.galleries.liveById(id)), false);
});

test('saveEdits trims the details, stores blank as NULL, enforces max lengths, keeps omitted fields', async () => {
  const id = fixture.service.create(fixture.owner);
  fixture.service.saveEdits(fixture.owner, id, {
    meta: { title: '  Hi  ', description: '   ', allowZip: true },
    images: [],
  });
  let g = fixture.context.galleries.liveById(id);
  assert.equal(g.title, 'Hi');
  assert.equal(g.description, null);
  assert.equal(g.allow_zip, 1);
  fixture.service.saveEdits(fixture.owner, id, { meta: { description: 'desc' }, images: [] });
  g = fixture.context.galleries.liveById(id);
  assert.equal(g.title, 'Hi');
  assert.equal(g.description, 'desc');
  assert.equal(g.allow_zip, 1);
  await assert.rejects(
    () => fixture.service.saveEdits(fixture.owner, id, { meta: { title: 'x'.repeat(MAX_TITLE + 1) }, images: [] }),
    isPublicError(ValidationError, `Title can be at most ${MAX_TITLE} characters.`, 400),
  );
  await assert.rejects(
    () =>
      fixture.service.saveEdits(fixture.owner, id, {
        meta: { description: 'x'.repeat(MAX_DESCRIPTION + 1) },
        images: [],
      }),
    isPublicError(ValidationError, `Description can be at most ${MAX_DESCRIPTION} characters.`, 400),
  );
});

test('saveEdits saves the grid text choice, keeps it when omitted, and refuses an unknown one', async () => {
  const id = fixture.service.create(fixture.owner);
  fixture.service.saveEdits(fixture.owner, id, { meta: { gridText: 'hide' }, images: [] });
  assert.equal(fixture.context.galleries.liveById(id).grid_text, 0);
  fixture.service.saveEdits(fixture.owner, id, { meta: { title: 'Kept' }, images: [] });
  assert.equal(fixture.context.galleries.liveById(id).grid_text, 0, 'omitted: kept');
  fixture.service.saveEdits(fixture.owner, id, { meta: { gridText: 'show' }, images: [] });
  assert.equal(fixture.context.galleries.liveById(id).grid_text, 1);
  fixture.service.saveEdits(fixture.owner, id, { meta: { gridText: 'default' }, images: [] });
  assert.equal(fixture.context.galleries.liveById(id).grid_text, null);
  await assert.rejects(
    () => fixture.service.saveEdits(fixture.owner, id, { meta: { gridText: 'loud' }, images: [] }),
    isPublicError(ValidationError, 'Choose how the gallery grid shows titles and captions.', 400),
  );
});

test('saveEdits saves a share theme and an image view choice, follows the site on default, and refuses unknown ones', async () => {
  const id = fixture.service.create(fixture.owner);
  await fixture.service.saveEdits(fixture.owner, id, {
    meta: { shareTheme: 'polaroid', imageView: 'page' },
    images: [],
  });
  let gallery = fixture.context.galleries.liveById(id);
  assert.deepEqual([gallery.share_theme, gallery.image_view], ['polaroid', 'page']);
  await fixture.service.saveEdits(fixture.owner, id, {
    meta: { shareTheme: FOLLOW_SITE, imageView: FOLLOW_SITE },
    images: [],
  });
  gallery = fixture.context.galleries.liveById(id);
  assert.deepEqual([gallery.share_theme, gallery.image_view], [null, null]);
  await assert.rejects(
    () => fixture.service.saveEdits(fixture.owner, id, { meta: { shareTheme: 'neon' }, images: [] }),
    isPublicError(ValidationError, SHARE_THEME_CHOICE.message, 400),
  );
  await assert.rejects(
    () => fixture.service.saveEdits(fixture.owner, id, { meta: { imageView: 'popup' }, images: [] }),
    isPublicError(ValidationError, IMAGE_VIEW_CHOICE.message, 400),
  );
});

test('saveEdits saves the details and the changed image texts together', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b] = [await add(g), await add(g)];
  fixture.service.saveEdits(fixture.owner, g, {
    meta: { title: 'Trip', gridText: 'hide' },
    images: [
      { imageId: a, title: '  Pier ', caption: '' },
      { imageId: b, caption: 'Late' },
    ],
  });
  const gallery = fixture.context.galleries.liveById(g);
  assert.deepEqual([gallery.title, gallery.grid_text], ['Trip', 0]);
  const [rowA, rowB] = [a, b].map((id) => fixture.context.galleryImages.byId(id));
  assert.deepEqual([rowA.title, rowA.caption], ['Pier', null]);
  assert.deepEqual([rowB.title, rowB.caption], [null, 'Late'], 'a field left out keeps its value');
});

test('saveEdits saves nothing when one image text is invalid, and names that image', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b] = [await add(g), await add(g)];
  await assert.rejects(
    () =>
      fixture.service.saveEdits(fixture.owner, g, {
        meta: { title: 'Trip' },
        images: [
          { imageId: a, title: 'Fine' },
          { imageId: b, caption: 'x'.repeat(MAX_CAPTION + 1) },
        ],
      }),
    isPublicError(ValidationError, 'Image #2: Caption can be at most 1000 characters.', 400),
  );
  assert.equal(fixture.context.galleries.liveById(g).title, null);
  assert.equal(fixture.context.galleryImages.byId(a).title, null);
});

test("saveEdits skips images that are not in the gallery, such as another gallery's", async () => {
  const mine = fixture.service.create(fixture.owner);
  const theirs = fixture.service.create(fixture.other);
  const foreign = await add(theirs);
  fixture.service.saveEdits(fixture.owner, mine, { meta: {}, images: [{ imageId: foreign, title: 'Taken' }] });
  assert.equal(fixture.context.galleryImages.byId(foreign).title, null);
  await assert.rejects(() => fixture.service.saveEdits(fixture.other, mine, { meta: {}, images: [] }), NotFoundError);
});

test('blank title/caption stored as NULL', async () => {
  const g = fixture.service.create(fixture.owner);
  const img = await add(g);
  fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: img, title: '  ', caption: '' }] });
  let row = fixture.context.galleryImages.byId(img);
  assert.equal(row.title, null);
  assert.equal(row.caption, null);
  fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: img, title: ' A ', caption: ' B ' }] });
  row = fixture.context.galleryImages.byId(img);
  assert.deepEqual([row.title, row.caption], ['A', 'B']);
  await assert.rejects(
    () =>
      fixture.service.saveEdits(fixture.owner, g, {
        meta: {},
        images: [{ imageId: img, title: 'x'.repeat(MAX_TITLE + 1) }],
      }),
    isPublicError(ValidationError, `Image #1: Title can be at most ${MAX_TITLE} characters.`, 400),
  );
  await assert.rejects(
    () =>
      fixture.service.saveEdits(fixture.owner, g, {
        meta: {},
        images: [{ imageId: img, caption: 'x'.repeat(MAX_CAPTION + 1) }],
      }),
    isPublicError(ValidationError, `Image #1: Caption can be at most ${MAX_CAPTION} characters.`, 400),
  );
});

test('addProcessedImage writes files, records bytes and touches the gallery', async () => {
  const g = fixture.service.create(fixture.owner);
  const img = await add(g, 'orig.jpg');
  const row = fixture.context.galleryImages.byId(img);
  assert.equal(row.original_name, 'orig.jpg');
  assert.equal(row.public_name.length, 10);
  assert.equal(row.bytes_orig, processedCache.original.length);
  assert.equal(row.bytes_web, processedCache.web.length);
  assert.equal(row.bytes_thumb, processedCache.thumb.length);
  const p = fixture.mediaStore.paths({ galleryId: g, imageId: img, ext: row.ext });
  assert.ok(fs.existsSync(p.orig) && fs.existsSync(p.web) && fs.existsSync(p.thumb));
});

test('addProcessedImage deletes the row and rethrows when the write fails', async (t) => {
  const g = fixture.service.create(fixture.owner);
  failWrites(t);
  await assert.rejects(add(g), /disk full/);
  assert.equal(fixture.context.galleryImages.count(g), 0);
});

test('addProcessedImage removes the files it wrote when the gallery was purged during the write', async (t) => {
  const g = fixture.service.create(fixture.owner);
  await add(g, 'kept-until-purge.jpg');
  const write = fixture.mediaStore.write.bind(fixture.mediaStore);
  t.mock.method(fixture.mediaStore, 'write', async (...args) => {
    fixture.service.trash(fixture.owner, g);
    await fixture.service.purge(fixture.owner, g);
    return write(...args);
  });
  const id = await add(g, 'late.jpg');
  assert.ok(!fs.existsSync(dirOf(g)), 'no files of the purged gallery stay on disk');
  assert.equal(id, null);
});

test('addProcessedImage removes the files it wrote when the image row was removed during the write', async (t) => {
  const g = fixture.service.create(fixture.owner);
  const kept = await add(g, 'kept.jpg');
  const write = fixture.mediaStore.write.bind(fixture.mediaStore);
  let late;
  t.mock.method(fixture.mediaStore, 'write', async (image, files) => {
    late = image.imageId;
    await fixture.service.removeImage(fixture.owner, image.galleryId, image.imageId);
    return write(image, files);
  });
  const id = await add(g, 'late.jpg');
  const gone = fixture.mediaStore.paths({ galleryId: g, imageId: late, ext: 'jpg' });
  assert.ok(!fs.existsSync(gone.orig) && !fs.existsSync(gone.web) && !fs.existsSync(gone.thumb), 'late files removed');
  assert.equal(id, null);
  const keptPaths = fixture.mediaStore.paths({ galleryId: g, imageId: kept, ext: 'jpg' });
  assert.ok(fs.existsSync(keptPaths.orig) && fs.existsSync(keptPaths.thumb), 'other images untouched');
});

test('addProcessedImage retries on public_name collision', async () => {
  const g = fixture.service.create(fixture.owner);
  const first = await add(g);
  const taken = fixture.context.galleryImages.byId(first).public_name;
  const names = [taken, taken, 'FreshName01'];
  const service = serviceWith(fixture.context, {
    effectiveConfigService: {
      limitValues: () => ({ ...DEFAULT_LIMITS }),
    },
    newPublicName: () => names.shift(),
  });
  const second = await service.addProcessedImage(g, { originalName: 'b.jpg', processed: distinctProcessed() });
  assert.equal(fixture.context.galleryImages.byId(second).public_name, 'FreshName01');
});

test('image operations through a gallery you own cannot touch another gallery image', async () => {
  const mine = fixture.service.create(fixture.owner);
  const theirs = fixture.service.create(fixture.other);
  const foreign = await add(theirs);
  await fixture.service.saveEdits(fixture.owner, mine, {
    meta: {},
    images: [
      { imageId: foreign, title: 'pwn' },
      { imageId: foreign, remove: true },
    ],
  });
  await assert.rejects(fixture.service.removeImage(fixture.owner, mine, foreign), NotFoundError);
  const row = fixture.context.galleryImages.byId(foreign);
  assert.ok(row);
  assert.equal(row.title, null);
  assert.ok(fs.existsSync(fixture.mediaStore.paths({ galleryId: theirs, imageId: foreign, ext: row.ext }).orig));
});

test('image edits, reorder, remove and add touch updated_by', async () => {
  const g = fixture.service.create(fixture.owner);
  const a = await add(g);
  assert.equal(fixture.context.galleries.liveById(g).updated_by, null);
  const by = () => fixture.context.galleries.liveById(g).updated_by;
  fixture.service.saveEdits(fixture.admin, g, { meta: {}, images: [{ imageId: a, title: 't' }] });
  assert.equal(by(), fixture.admin.id);
  fixture.service.reorder(fixture.owner, g, [a]);
  assert.equal(by(), fixture.owner.id);
  await fixture.service.removeImage(fixture.admin, g, a);
  assert.equal(by(), fixture.admin.id);
  assert.equal(fixture.context.galleryImages.count(g), 0);
  assert.ok(!fs.existsSync(fixture.mediaStore.paths({ galleryId: g, imageId: a, ext: 'jpg' }).orig));
});

test('checkUpload rejects count over maxImagesPerGallery with the exact message', async () => {
  fixture.limits.maxImagesPerGallery = 3;
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, null, { count: 4, bytes: 10 }),
    isPublicError(LimitExceededError, 'This upload has 4 images; a gallery can hold 3.'),
  );
  fixture.service.checkUpload(fixture.owner.id, null, { count: 3, bytes: 10 });
  const g = fixture.service.create(fixture.owner);
  await add(g);
  await add(g);
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, g, { count: 2, bytes: 10 }),
    isPublicError(LimitExceededError, 'This gallery has 2 images and can hold 3; this upload adds 2.', 413),
  );
});

test("checkUpload counts quota against the owner when an admin uploads, and names the owner's storage", async () => {
  fixture.limits.userQuotaMb = 1;
  const g = fixture.service.create(fixture.owner);
  const img = await add(g);
  fixture.context.galleryImages.setBytes(img, { bytesOrig: 600 * 1024, bytesWeb: 0, bytesThumb: 0 });
  assert.throws(
    () => fixture.service.checkUpload(fixture.admin.id, g, { count: 1, bytes: 600 * 1024 }),
    isPublicError(LimitExceededError, "This upload would use 1 MB of the gallery owner's 1 MB storage."),
  );
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, g, { count: 1, bytes: 600 * 1024 }),
    isPublicError(LimitExceededError, 'This upload would use 1 MB of your 1 MB storage.'),
    'the owner is told about their own storage',
  );
  fixture.service.checkUpload(fixture.admin.id, g, { count: 1, bytes: 100 * 1024 });
  fixture.limits.userQuotaMb = 0;
  fixture.service.checkUpload(fixture.admin.id, g, { count: 1, bytes: 900 * BYTES_PER_MB });
});

test('an unfinished ingest job reserves its images against maxImagesPerGallery until it ends', async () => {
  fixture.limits.maxImagesPerGallery = 5;
  const g = fixture.service.create(fixture.owner);
  await add(g);
  const jobs = fixture.context.ingestJobs;
  const job = jobs.insert({ userId: fixture.owner.id, galleryId: g, total: 3 });
  fixture.service.checkUpload(fixture.owner.id, g, { count: 1, bytes: 1 });
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, g, { count: 2, bytes: 1 }),
    isPublicError(LimitExceededError, 'This gallery has 4 images and can hold 5; this upload adds 2.'),
  );
  jobs.setRunning(job);
  jobs.progress(job, 2, []);
  fixture.service.checkUpload(fixture.owner.id, g, { count: 2, bytes: 1 });
  assert.throws(() => fixture.service.checkUpload(fixture.owner.id, g, { count: 4, bytes: 1 }), LimitExceededError);
  jobs.setDone(job);
  fixture.service.checkUpload(fixture.owner.id, g, { count: 4, bytes: 1 });
  const failed = jobs.insert({ userId: fixture.owner.id, galleryId: g, total: 4 });
  assert.throws(() => fixture.service.checkUpload(fixture.owner.id, g, { count: 1, bytes: 1 }), LimitExceededError);
  jobs.setFailed(failed, 'stopped');
  fixture.service.checkUpload(fixture.owner.id, g, { count: 4, bytes: 1 });
  const other = fixture.service.create(fixture.owner);
  jobs.insert({ userId: fixture.owner.id, galleryId: other, total: 5 });
  fixture.service.checkUpload(fixture.owner.id, g, { count: 4, bytes: 1 });
});

test("an unfinished ingest job's bytes count toward the owner's quota until it ends", () => {
  fixture.limits.userQuotaMb = 10;
  const g = fixture.service.create(fixture.owner);
  const jobs = fixture.context.ingestJobs;
  const job = jobs.insert({ userId: fixture.admin.id, galleryId: g, total: 1, bytes: 8 * BYTES_PER_MB });
  fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 2 * BYTES_PER_MB });
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 3 * BYTES_PER_MB }),
    isPublicError(LimitExceededError, 'This upload would use 11 MB of your 10 MB storage.'),
  );
  fixture.service.checkUpload(fixture.admin.id, null, { count: 1, bytes: 9 * BYTES_PER_MB });
  jobs.setRunning(job);
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 3 * BYTES_PER_MB }),
    LimitExceededError,
  );
  jobs.setDone(job);
  fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 9 * BYTES_PER_MB });
  const failed = jobs.insert({ userId: fixture.owner.id, galleryId: g, total: 1, bytes: 9 * BYTES_PER_MB });
  assert.throws(
    () => fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 2 * BYTES_PER_MB }),
    LimitExceededError,
  );
  jobs.setFailed(failed, 'stopped');
  fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 9 * BYTES_PER_MB });
});

test('checkUpload leaves file and batch sizes to the upload middleware: large byte totals pass without a quota', () => {
  fixture.limits.maxZipUploadMb = 5;
  fixture.limits.maxUploadBatchMb = 10;
  fixture.service.checkUpload(fixture.owner.id, null, { count: 1, bytes: 50 * BYTES_PER_MB });
});

test('reorder with a stale id set throws ConflictError and changes nothing', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b, c] = [await add(g), await add(g), await add(g)];
  await fixture.service.removeImage(fixture.admin, g, b);
  assert.throws(
    () => fixture.service.reorder(fixture.owner, g, [c, b, a]),
    isPublicError(ConflictError, 'This gallery changed. Reload and try again.', 409),
  );
  assert.deepEqual(
    fixture.context.galleryImages.forGallery(g).map((r) => r.id),
    [a, c],
  );
  fixture.service.reorder(fixture.owner, g, [c, a]);
  assert.deepEqual(
    fixture.context.galleryImages.forGallery(g).map((r) => r.id),
    [c, a],
  );
});

test('lowering maxImagesPerGallery below current count still allows edit, reorder and remove, but checkUpload rejects', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b, c] = [await add(g), await add(g), await add(g)];
  fixture.limits.maxImagesPerGallery = 1;
  fixture.service.saveEdits(fixture.owner, g, {
    meta: { title: 'still ok', description: '', allowZip: false },
    images: [],
  });
  fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: a, title: 'x' }] });
  fixture.service.reorder(fixture.owner, g, [c, b, a]);
  await fixture.service.removeImage(fixture.owner, g, b);
  assert.throws(() => fixture.service.checkUpload(fixture.owner.id, g, { count: 1, bytes: 1 }), LimitExceededError);
});

test('purge, emptyTrash and purgeTrashedBefore remove the media folder', async () => {
  const g1 = fixture.service.create(fixture.owner);
  const g2 = fixture.service.create(fixture.owner);
  const g3 = fixture.service.create(fixture.owner);
  for (const g of [g1, g2, g3]) await add(g);
  for (const g of [g1, g2, g3]) assert.ok(fs.existsSync(dirOf(g)));
  fixture.service.trash(fixture.owner, g1);
  await fixture.service.purge(fixture.owner, g1);
  assert.ok(!fs.existsSync(dirOf(g1)));
  assert.equal(fixture.context.galleries.byIdIncludingTrashed(g1), null);
  fixture.service.trash(fixture.admin, g2);
  await fixture.service.emptyTrash(fixture.owner);
  assert.ok(!fs.existsSync(dirOf(g2)));
  fixture.service.trash(fixture.owner, g3);
  await fixture.service.purgeTrashedBefore(new Date(clock.now().getTime() + MS_PER_DAY).toISOString());
  assert.ok(!fs.existsSync(dirOf(g3)));
});

test('restore brings a trashed gallery back; purge refuses a live one; both take the acting user', async () => {
  const g = fixture.service.create(fixture.owner);
  await add(g);
  fixture.service.trash(fixture.owner, g);
  throwsNotFound(() => fixture.service.trash(fixture.other, g));
  throwsNotFound(() => fixture.service.restore(fixture.other, g), 'another user cannot restore it');
  await assert.rejects(fixture.service.purge(fixture.other, g), NotFoundError, 'another user cannot purge it');
  assert.equal(fixture.service.restore(fixture.owner, g), undefined);
  throwsNotFound(() => fixture.service.restore(fixture.owner, g), 'a live gallery is not in Trash');
  await assert.rejects(fixture.service.purge(fixture.owner, g), NotFoundError, 'purge refuses a live gallery');
  assert.ok(fs.existsSync(dirOf(g)));
  assert.equal(fixture.context.galleries.liveById(g).deleted_at, null);
});

test('trash by a non-owner non-admin throws NotFoundError', () => {
  const g = fixture.service.create(fixture.owner);
  throwsNotFound(() => fixture.service.trash(fixture.other, g));
  assert.equal(fixture.context.galleries.liveById(g).deleted_at, null);
});

test('idsForUser lists live and trashed galleries, and removeMedia removes their media folders', async () => {
  const g1 = fixture.service.create(fixture.owner);
  const g2 = fixture.service.create(fixture.owner);
  await add(g1);
  await add(g2);
  fixture.service.trash(fixture.owner, g2);
  const ids = fixture.service.idsForUser(fixture.owner.id);
  assert.deepEqual(ids, [g1, g2]);
  assert.equal(await fixture.service.removeMedia(ids), 2);
  assert.ok(!fs.existsSync(dirOf(g1)) && !fs.existsSync(dirOf(g2)));
});

test('purgeTrashedBefore logs media removal failures and keeps removing the rest', async (t) => {
  const g1 = fixture.service.create(fixture.owner);
  const g2 = fixture.service.create(fixture.owner);
  for (const g of [g1, g2]) await add(g);
  fixture.service.trash(fixture.owner, g1);
  fixture.service.trash(fixture.owner, g2);
  const removeGallery = fixture.mediaStore.removeGallery.bind(fixture.mediaStore);
  t.mock.method(fixture.mediaStore, 'removeGallery', async (id) => {
    if (id === g1) throw new Error('disk gone');
    return removeGallery(id);
  });
  const count = await fixture.service.purgeTrashedBefore(new Date(clock.now().getTime() + MS_PER_DAY).toISOString());
  assert.equal(count, 2);
  assert.equal(fixture.context.galleries.byIdIncludingTrashed(g1), null);
  assert.ok(!fs.existsSync(dirOf(g2)));
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1].galleryId, g1);
  assert.equal(logged[0][1].error, 'disk gone');
});

const accessDenied = () => Object.assign(new Error('permission denied'), { code: 'EACCES' });

const failImageRemoval = (t) => {
  t.mock.method(fixture.mediaStore, 'removeImage', async () => {
    throw accessDenied();
  });
};

function failWrites(t) {
  t.mock.method(fixture.mediaStore, 'write', async () => {
    throw new Error('disk full');
  });
}

test('removeImage resolves and logs when the file removal fails after the row is deleted', async (t) => {
  const g = fixture.service.create(fixture.owner);
  const img = await add(g);
  failImageRemoval(t);
  await fixture.service.removeImage(fixture.owner, g, img);
  assert.equal(fixture.context.galleryImages.byId(img), null, 'the row is gone');
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Could not remove image files');
  assert.deepEqual(logged[0][1], { galleryId: g, imageId: img, error: 'permission denied', code: 'EACCES' });
});

test('addProcessedImage returns null and logs when removing late files fails', async (t) => {
  const g = fixture.service.create(fixture.owner);
  const write = fixture.mediaStore.write.bind(fixture.mediaStore);
  t.mock.method(fixture.mediaStore, 'write', async (image, files) => {
    fixture.context.galleryImages.remove(image.imageId);
    return write(image, files);
  });
  failImageRemoval(t);
  assert.equal(await add(g), null);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1].code, 'EACCES');
});

test('addProcessedImage rethrows the write error and logs a failed cleanup', async (t) => {
  const g = fixture.service.create(fixture.owner);
  failWrites(t);
  failImageRemoval(t);
  await assert.rejects(add(g), /disk full/);
  assert.equal(fixture.context.galleryImages.count(g), 0);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1].code, 'EACCES');
});

test('removeUnwrittenImages removes the rows and logs a failed file removal', async (t) => {
  const g = fixture.service.create(fixture.owner);
  const img = await add(g);
  fixture.context.galleryImages.setBytes(img, { bytesOrig: 0, bytesWeb: 0, bytesThumb: 0 });
  failImageRemoval(t);
  assert.equal(await fixture.service.removeUnwrittenImages(), 1);
  assert.equal(fixture.context.galleryImages.byId(img), null);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], { galleryId: g, imageId: img, error: 'permission denied', code: 'EACCES' });
});

test('addProcessedImage refuses the same picture already in the gallery and stores nothing', async () => {
  const g = fixture.service.create(fixture.owner);
  const processed = distinctProcessed();
  await fixture.service.addProcessedImage(g, { originalName: 'a.jpg', processed });
  await assert.rejects(
    fixture.service.addProcessedImage(g, { originalName: 'b.jpg', processed }),
    isPublicError(ValidationError, 'Already in this gallery.', 400),
  );
  assert.equal(fixture.context.galleryImages.count(g), 1);
});

const clearHashes = (...ids) => {
  for (const id of ids) fixture.context.galleryImages.setPhash(id, null);
};

test('backfillPhashes hashes images stored without a hash from their web file', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b] = [await add(g), await add(g)];
  clearHashes(a, b);
  assert.equal(await fixture.service.backfillPhashes(), 2);
  const web = fixture.mediaStore.paths({ galleryId: g, imageId: a, ext: 'jpg' }).web;
  assert.equal(fixture.context.galleryImages.byId(a).phash, await dhash(fs.readFileSync(web)));
  assert.match(fixture.context.galleryImages.byId(b).phash, /^[0-9a-f]{16}$/);
  assert.equal(await fixture.service.backfillPhashes(), 0, 'nothing left to do');
});

test('backfillPhashes logs an image whose web file is gone and carries on with the rest', async () => {
  const g = fixture.service.create(fixture.owner);
  const [a, b] = [await add(g), await add(g)];
  clearHashes(a, b);
  fs.rmSync(fixture.mediaStore.paths({ galleryId: g, imageId: a, ext: 'jpg' }).web);
  assert.equal(await fixture.service.backfillPhashes(), 1);
  assert.equal(fixture.context.galleryImages.byId(a).phash, null);
  assert.ok(fixture.context.galleryImages.byId(b).phash);
  assert.equal(warned.length, 1);
  assert.equal(warned[0][0], 'could not hash image');
  assert.equal(warned[0][1].imageId, a);
});

test('backfillPhashes stops before the next image once `stopped` says so', async () => {
  const g = fixture.service.create(fixture.owner);
  const ids = [await add(g), await add(g), await add(g)];
  clearHashes(...ids);
  let calls = 0;
  const stopped = () => ++calls > 1;
  assert.equal(await fixture.service.backfillPhashes({ stopped }), 1);
  assert.equal(fixture.context.galleryImages.withoutPhash(10).length, 2);
});

test('the galleries service exposes exactly these methods', () => {
  assert.deepEqual(Object.keys(fixture.service).sort(), [
    'addProcessedImage',
    'backfillPhashes',
    'canManage',
    'checkUpload',
    'countLive',
    'countTrashed',
    'create',
    'dashboardTotals',
    'emptyTrash',
    'findLive',
    'getForEdit',
    'getManageable',
    'idsForUser',
    'imageByPublicName',
    'imageForViewer',
    'imagesHeldOrReserved',
    'imagesOf',
    'listAll',
    'listForUser',
    'listTrash',
    'markEdited',
    'purge',
    'purgeTrashedBefore',
    'removeImage',
    'removeMedia',
    'removeUnwrittenImages',
    'reorder',
    'restore',
    'saveEdits',
    'trash',
  ]);
  for (const [name, value] of Object.entries(fixture.service)) assert.equal(typeof value, 'function', name);
});

test('saveEdits changes only the fields sent; non-text values count as blank', async () => {
  const g = fixture.service.create(fixture.owner);
  fixture.service.saveEdits(fixture.owner, g, {
    meta: { title: ' Trip ', description: 'Long', allowZip: 'on' },
    images: [],
  });
  fixture.service.saveEdits(fixture.owner, g, { meta: { description: ['not', 'text'] }, images: [] });
  const row = fixture.context.galleries.liveById(g);
  assert.deepEqual([row.title, row.description, row.allow_zip], ['Trip', null, 1]);
  const id = await add(g);
  fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: id, caption: ' Hi ' }] });
  fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: id, title: 'T' }] });
  const image = fixture.context.galleryImages.byId(id);
  assert.deepEqual([image.title, image.caption], ['T', 'Hi']);
  await assert.rejects(
    () =>
      fixture.service.saveEdits(fixture.owner, g, { meta: {}, images: [{ imageId: id, title: 'x'.repeat(10_000) }] }),
    {
      message: /Title can be at most \d+ characters\./,
    },
  );
});

const recordingService = () =>
  serviceWith(fixture.context, {
    activityService: fixture.context.activityService,
    runInTransaction: fixture.context.runInTransaction,
  });

const events = (...kinds) => activityLog(fixture.context, { kinds: kinds.length ? kinds : undefined });

test('activity: creating a gallery records galleryCreated', () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  const [event, ...rest] = events('galleryCreated');
  assert.equal(rest.length, 0);
  assert.equal(event.gallery_id, id);
  assert.equal(event.actor_id, fixture.owner.id);
  assert.equal(event.subject_user_id, null);
});

test('activity: saveEdits records one event listing only the changed fields and image texts', async () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  const a = await add(id, 'a.jpg');
  const b = await add(id, 'b.jpg');
  service.saveEdits(fixture.owner, id, {
    meta: { title: 'Trip', gridText: 'show' },
    images: [
      { imageId: a, title: 'One' },
      { imageId: b, caption: 'Two' },
    ],
  });
  const [event, ...rest] = events('galleryDetailsChanged');
  assert.equal(rest.length, 0);
  assert.equal(event.details, 'title, grid text, 2 image texts');
  assert.equal(event.gallery_title, 'Trip');
  service.saveEdits(fixture.owner, id, { meta: { title: ' Trip ', description: 'd', allowZip: false }, images: [] });
  assert.equal(events('galleryDetailsChanged')[1].details, 'description');
  service.saveEdits(fixture.owner, id, { meta: { title: 'Trip' }, images: [{ imageId: a, title: 'One' }] });
  service.saveEdits(fixture.owner, id, { meta: { title: 'Trip' }, images: [] });
  assert.equal(events('galleryDetailsChanged').length, 2, 'nothing changed, nothing recorded');
  service.saveEdits(fixture.owner, id, { meta: { allowZip: true }, images: [] });
  assert.equal(events('galleryDetailsChanged')[2].details, 'ZIP download');
  service.saveEdits(fixture.owner, id, { meta: {}, images: [{ imageId: a, title: 'Uno' }] });
  assert.equal(events('galleryDetailsChanged')[3].details, '1 image text');
});

test("activity: an admin editing another user's gallery records the owner as subject", () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  service.saveEdits(fixture.admin, id, { meta: { title: 'Renamed' }, images: [] });
  const [event] = events('galleryDetailsChanged');
  assert.equal(event.actor_id, fixture.admin.id);
  assert.equal(event.subject_user_id, fixture.owner.id);
});

test('activity: removing an image records its position', async () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  await add(id, 'a.jpg');
  await add(id, 'b.jpg');
  await add(id, 'c.jpg');
  const d = await add(id, 'd.jpg');
  await service.removeImage(fixture.owner, id, d);
  const [event] = events('imageRemoved');
  assert.equal(event.details, 'Image #4');
  await assert.rejects(service.removeImage(fixture.owner, id, d), NotFoundError);
  assert.equal(events('imageRemoved').length, 1);
});

test('activity: moving to Trash names the owner when an admin did it; restoring is recorded', async () => {
  const service = recordingService();
  const g1 = service.create(fixture.owner);
  await service.saveEdits(fixture.owner, g1, { meta: { title: 'Keep' }, images: [] });
  service.trash(fixture.admin, g1);
  const [trashed] = events('galleryTrashed');
  assert.equal(trashed.gallery_title, 'Keep');
  assert.equal(trashed.subject_user_id, fixture.owner.id);
  service.restore(fixture.owner, g1);
  assert.equal(events('galleryRestored')[0].gallery_id, g1);
});

test('activity: deleting a gallery for good records galleryDeleted with its title', async () => {
  const service = recordingService();
  const g1 = service.create(fixture.owner);
  await service.saveEdits(fixture.owner, g1, { meta: { title: 'Keep' }, images: [] });
  service.trash(fixture.owner, g1);
  await service.purge(fixture.owner, g1);
  const [deleted] = events('galleryDeleted');
  assert.equal(deleted.gallery_title, 'Keep');
  assert.equal(deleted.subject_user_id, null);
});

test('activity: emptying Trash records how many galleries went, in words; an empty Trash records nothing', async () => {
  const service = recordingService();
  service.trash(fixture.owner, service.create(fixture.owner));
  service.trash(fixture.owner, service.create(fixture.owner));
  await service.emptyTrash(fixture.owner);
  assert.equal(events('trashEmptied')[0].details, '2 galleries');
  service.trash(fixture.owner, service.create(fixture.owner));
  await service.emptyTrash(fixture.owner);
  assert.equal(events('trashEmptied')[1].details, '1 gallery');
  await service.emptyTrash(fixture.owner);
  assert.equal(events('trashEmptied').length, 2, 'an empty Trash records nothing');
  assert.equal(events('galleryDeleted').length, 0, 'emptying is one event, not one per gallery');
});

test('activity: purgeTrashedBefore deletes expired galleries without recording any activity', async () => {
  const service = recordingService();
  const expired = service.create(fixture.owner);
  service.trash(fixture.owner, expired);
  const before = events().length;
  const purged = await service.purgeTrashedBefore(new Date(clock.now().getTime() + MS_PER_DAY).toISOString());
  assert.equal(purged, 1, 'the expired gallery was really purged');
  assert.equal(fixture.context.galleries.byIdIncludingTrashed(expired), null);
  assert.equal(events().length, before, 'purgeTrashedBefore is not a user action');
});

test('activity: a successful reorder records imagesReordered, a refused one does not', async () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  const [a, b] = [await add(id, 'a.jpg'), await add(id, 'b.jpg')];
  service.reorder(fixture.owner, id, [b, a]);
  assert.equal(events('imagesReordered').length, 1);
  assert.throws(() => service.reorder(fixture.owner, id, [b]), ConflictError);
  assert.equal(events('imagesReordered').length, 1, 'a refused reorder is not recorded');
});

test("activity: an admin reordering another user's gallery records the owner as subject", async () => {
  const service = recordingService();
  const id = service.create(fixture.owner);
  const [a, b] = [await add(id, 'a.jpg'), await add(id, 'b.jpg')];
  service.reorder(fixture.admin, id, [b, a]);
  const [event] = events('imagesReordered');
  assert.equal(event.actor_id, fixture.admin.id);
  assert.equal(event.subject_user_id, fixture.owner.id);
  assert.equal(event.gallery_id, id);
});
