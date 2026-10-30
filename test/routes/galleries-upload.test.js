import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_MB } from '../../lib/size.js';
import fs from 'node:fs';
import yauzl from 'yauzl';
import path from 'node:path';
import { attrsOf, countAttr, decodeEntities, elementByAttr, elementsByTag, startApp, textOf } from '../helpers/http.js';
import { distinctJpegs, makeJpeg, makePng } from '../helpers/images.js';
import { writeEmptyEntriesZip } from '../helpers/zip.js';
import { jobIdFrom, withLimits } from '../helpers/uploads.js';
import { rowCount } from '../helpers/db.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { NO_USABLE, galleryKit } from './support/galleries-kit.js';

let app;
let jpeg;
let photos;
before(async () => {
  app = await startApp({}, { media: 'gs-galleries-upload-' });
  jpeg = await makeJpeg();
  photos = await distinctJpegs(40);
});
after(() => app.close());

const {
  galleryCount,
  tmpFiles,
  assertNothingStored,
  upload,
  nextPhoto,
  jpegs,
  zipFile,
  jobOf,
  newGallery,
  imageIds,
  originalNames,
  renderedIds,
  spyEntryReads,
} = galleryKit(() => ({ app, photos }));

test('a mixed upload of 2 images and 2 ZIPs (nested folders, junk) creates one job in the expected order', async () => {
  const session = await app.signedIn();
  const png = await makePng({ width: 12, height: 12 });
  const before = galleryCount();
  const res = await upload(session, PATHS.newGalleryUpload, [
    await zipFile('trip10.zip', [
      { name: 'day/' },
      { name: 'day/b.jpg', data: nextPhoto() },
      { name: 'day/a.png', data: png },
      { name: '__MACOSX/day/._a.png', data: 'resource fork' },
      { name: 'day/.hidden.jpg', data: nextPhoto() },
      { name: 'readme.txt', data: 'hello' },
    ]),
    ...jpegs('loose10.jpg'),
    await zipFile('trip2.zip', [
      { name: 'x/y/deep.jpg', data: nextPhoto() },
      { name: 'fake.jpg', data: 'renamed text file' },
    ]),
    ...jpegs('loose2.jpg'),
  ]);
  assert.equal(res.status, 303);
  assert.equal(galleryCount(), before + 1);
  const queued = jobOf(res);
  assert.equal(queued.total, 5, 'loose images plus usable ZIP entries');
  await app.context.ingestService.idle();
  const job = jobOf(res);
  assert.equal(job.status, 'done');
  assert.deepEqual(originalNames(job.gallery_id), ['loose2.jpg', 'loose10.jpg', 'deep.jpg', 'a.png', 'b.jpg']);
  assert.deepEqual(job.skipped, [
    { name: 'trip2.zip/fake.jpg', reason: 'Not a JPEG, PNG or WebP image.', atUpload: true },
  ]);
  const { html } = await app.get(session, PATH_TO.gallery(job.gallery_id));
  assert.equal(renderedIds(html).length, 5, 'the edit view shows every image');
  assert.match(html, /trip2\.zip\/fake\.jpg/);
  assert.match(decodeEntities(html), /Not a JPEG, PNG or WebP image\./);
  assert.equal(rowCount(app.context.db, 'ingest_jobs', 'gallery_id = ?', job.gallery_id), 1, 'one job per upload');
  assert.deepEqual(tmpFiles(), []);
});

test('two ZIP files in one upload create a gallery; folders stay grouped in natural path order', async () => {
  const session = await app.signedIn();
  const res = await upload(session, PATHS.newGalleryUpload, [
    await zipFile('b.zip', [
      { name: 'def/3.jpg', data: nextPhoto() },
      { name: 'abc/10.jpg', data: nextPhoto() },
      { name: 'def/1.jpg', data: nextPhoto() },
      { name: 'abc/2.jpg', data: nextPhoto() },
    ]),
    await zipFile('a.zip', [{ name: 'only.jpg', data: nextPhoto() }]),
  ]);
  assert.equal(res.status, 303);
  await app.context.ingestService.idle();
  const job = jobOf(res);
  assert.equal(job.status, 'done');
  assert.deepEqual(originalNames(job.gallery_id), ['only.jpg', '2.jpg', '10.jpg', '1.jpg', '3.jpg']);
});

test('a ZIP with only non-images is fine next to other images, but an upload with no usable images creates nothing', async () => {
  const session = await app.signedIn();
  const before = galleryCount();
  const empty = await zipFile('empty.zip', [{ name: 'readme.txt', data: 'hi' }]);
  const fake = await zipFile('fake.zip', [{ name: 'fake.jpg', data: 'renamed text file' }]);

  const withImage = await upload(session, PATHS.newGalleryUpload, [empty, ...jpegs('a.jpg')]);
  assert.equal(withImage.status, 303);
  await app.context.ingestService.idle();
  assert.equal(galleryCount(), before + 1);

  for (const files of [[empty], [fake], [empty, fake]]) {
    const res = await upload(session, PATHS.newGalleryUpload, files);
    assert.equal(res.status, 422, files.map((f) => f.name).join());
    const html = await res.text();
    assert.match(html, NO_USABLE);
    assert.ok(html.includes(`action="${PATHS.newGalleryUpload}"`), 're-renders the form');
  }
  assert.equal(galleryCount(), before + 1, 'no gallery for an upload with no usable images');
  assert.deepEqual(tmpFiles(), []);
});

test('an unsupported file in the batch refuses the whole upload and stores nothing', async () => {
  const session = await app.signedIn();
  const before = galleryCount();
  const res = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg'),
    await zipFile('ok.zip', [{ name: 'b.jpg', data: nextPhoto() }]),
    { name: 'notes.pdf', data: Buffer.from('%PDF-1.4') },
  ]);
  assert.equal(res.status, 422);
  assert.match(await res.text(), /Only JPEG, PNG, WebP images or ZIP files can be uploaded\./);
  assertNothingStored(before);
});

test('per-type size caps and the batch total refuse the upload and create no gallery', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  const bigZip = {
    name: 'big.zip',
    data: Buffer.concat([(await zipFile('x', jpegs('1.jpg'))).data, Buffer.alloc(BYTES_PER_MB)]),
  };
  withLimits(t, app.context, { maxImageMb: 1, maxZipUploadMb: 1 });
  const image = await upload(session, PATHS.newGalleryUpload, [
    { name: 'huge.jpg', data: Buffer.alloc(BYTES_PER_MB + 10) },
  ]);
  assert.equal(image.status, 413);
  assert.match(await image.text(), /huge\.jpg is larger than 1 MB\./);
  const zip = await upload(session, PATHS.newGalleryUpload, [...jpegs('a.jpg'), bigZip]);
  assert.equal(zip.status, 413);
  assert.match(await zip.text(), /The ZIP file big\.zip is larger than 1 MB\./);
  withLimits(t, app.context, { maxZipUploadMb: 5, maxUploadBatchMb: 1 });
  const batch = await upload(session, PATHS.newGalleryUpload, [...jpegs('a.jpg'), bigZip]);
  assert.equal(batch.status, 413);
  assert.match(await batch.text(), /uploads are limited to 1 MB\./);
  assertNothingStored(before);
});

test('the image count counts ZIP entries, loose images, existing and pending images', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { maxImagesPerGallery: 3 });
  const over = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg', 'b.jpg'),
    await zipFile('two.zip', jpegs('1.jpg', '2.jpg')),
  ]);
  assert.equal(over.status, 413);
  assert.match(await over.text(), /This upload has more than 3 images; a gallery can hold 3\./);
  assert.equal(galleryCount(), before);

  const fits = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg', 'b.jpg'),
    await zipFile('mixed.zip', [
      { name: '1.jpg', data: nextPhoto() },
      { name: 'fake.jpg', data: 'text' },
    ]),
  ]);
  assert.equal(fits.status, 303);
  await app.context.ingestService.idle();
  const galleryId = jobOf(fits).gallery_id;
  assert.equal(imageIds(galleryId).length, 3);

  withLimits(t, app.context, { maxImagesPerGallery: 4 });
  const more = await upload(session, PATH_TO.gallery(galleryId, 'upload'), [
    await zipFile('two.zip', jpegs('1.jpg', '2.jpg')),
  ]);
  assert.equal(more.status, 413);
  assert.match(await more.text(), /This gallery has 3 images and can hold 4; this upload adds more than 1\./);

  const huge = await upload(session, PATHS.newGalleryUpload, [
    await zipFile('five.zip', jpegs('1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg')),
  ]);
  assert.equal(huge.status, 413);
  assert.match(await huge.text(), /This upload has more than 4 images; a gallery can hold 4\./);
  assert.deepEqual(tmpFiles(), []);
});

test('the quota counts loose image sizes plus the uncompressed size of ZIP entries', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { userQuotaMb: 1 });
  const padded = Buffer.concat([jpeg, Buffer.alloc(1024 * 1024 + 1)]);
  const zip = await zipFile('big.zip', [{ name: 'big.jpg', data: padded }]);
  assert.ok(zip.data.length < 100 * 1024, 'the ZIP itself is small');
  const res = await upload(session, PATHS.newGalleryUpload, [zip]);
  assert.equal(res.status, 413);
  assert.match(await res.text(), /of your 1 MB storage/);
  assertNothingStored(before);
});

test('a ZIP of 50 000 tiny entries is refused by the per-ZIP entry cap before any entry is read, and creates no gallery', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { maxImagesPerGallery: 2 });
  const file = writeEmptyEntriesZip(
    path.join(fs.mkdtempSync(path.join(app.root, 'zip-')), 'flood.zip'),
    Array.from({ length: 50_000 }, (_, i) => `d/${i}.jpg`),
  );
  const reads = spyEntryReads(t);
  const walked = t.mock.method(yauzl.ZipFile.prototype, 'readEntry');
  const res = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg'),
    { name: 'flood.zip', data: fs.readFileSync(file) },
  ]);
  assert.equal(res.status, 413);
  assert.match(await res.text(), /flood\.zip has too many files \(more than 10000\)\./);
  assert.ok(
    walked.mock.callCount() <= 10_001,
    `the directory walk stops at the 10 000-entry cap: ${walked.mock.callCount()} of 50 000 entries read`,
  );
  assert.equal(reads.mock.callCount(), 0, 'no entry is opened or sniffed');
  assertNothingStored(before);
});

test('more image-named entries than the room left are refused before every entry is sniffed', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { maxImagesPerGallery: 2 });
  const many = await zipFile(
    'many.zip',
    Array.from({ length: 5000 }, (_, i) => ({ name: `p/${i}.jpg`, data: nextPhoto() })),
  );
  const reads = spyEntryReads(t);
  const res = await upload(session, PATHS.newGalleryUpload, [many]);
  assert.equal(res.status, 413);
  assert.match(await res.text(), /This upload has more than 2 images; a gallery can hold 2\./);
  assert.equal(reads.mock.callCount(), 3, 'only the entries up to the first one over the room are sniffed');
  assertNothingStored(before);
});

test('the count budget is shared by every ZIP and loose image of one upload', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { maxImagesPerGallery: 3 });
  const res = await upload(session, PATHS.newGalleryUpload, [
    await zipFile('one.zip', jpegs('1.jpg', '2.jpg')),
    await zipFile('two.zip', jpegs('3.jpg', '4.jpg')),
  ]);
  assert.equal(res.status, 413);
  assert.match(await res.text(), /This upload has more than 3 images; a gallery can hold 3\./);
  const withLoose = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg', 'b.jpg'),
    await zipFile('one.zip', jpegs('1.jpg', '2.jpg')),
  ]);
  assert.equal(withLoose.status, 413);
  assert.match(await withLoose.text(), /This upload has more than 3 images; a gallery can hold 3\./);
  assertNothingStored(before);
});

test('at most 100 ZIP entries per upload may fail the sniff; one more refuses the upload', async () => {
  const session = await app.signedIn();
  const before = galleryCount();
  const fakes = (name, count) => ({
    name,
    data: fs.readFileSync(
      writeEmptyEntriesZip(
        path.join(fs.mkdtempSync(path.join(app.root, 'zip-')), `${name}-${count}`),
        Array.from({ length: count }, (_, i) => `f/${i}.jpg`),
      ),
    ),
  });
  const over = await upload(session, PATHS.newGalleryUpload, [...jpegs('a.jpg'), fakes('fakes.zip', 101)]);
  assert.equal(over.status, 413);
  assert.match(
    await over.text(),
    /fakes\.zip has too many files that are not real images \(more than 100 per upload\)\./,
  );
  const shared = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg'),
    fakes('a.zip', 60),
    fakes('b.zip', 41),
  ]);
  assert.equal(shared.status, 413, 'the cap is per upload, across ZIPs');
  assert.match(
    await shared.text(),
    /b\.zip has too many files that are not real images \(more than 100 per upload\)\./,
  );
  assert.equal(galleryCount(), before);

  const fits = await upload(session, PATHS.newGalleryUpload, [...jpegs('a.jpg'), fakes('fakes.zip', 100)]);
  assert.equal(fits.status, 303);
  await app.context.ingestService.idle();
  assert.equal(jobOf(fits).skipped.length, 100);
  assert.deepEqual(tmpFiles(), []);
});

test('a job lists at most 100 skipped files by name and counts the rest in one line', async () => {
  const session = await app.signedIn();
  const broken = Buffer.concat([jpeg.subarray(0, 12), Buffer.from('broken')]);
  const files = [
    ...jpegs('good.jpg'),
    ...Array.from({ length: 150 }, (_, i) => ({ name: `bad${i}.jpg`, data: broken })),
  ];
  const res = await upload(session, PATHS.newGalleryUpload, files);
  assert.equal(res.status, 303);
  await app.context.ingestService.idle();
  const job = jobOf(res);
  assert.equal(job.processed, 151);
  assert.equal(job.skipped.length, 101);
  assert.deepEqual(job.skipped.at(-1), { name: '…', reason: 'and 50 more files were skipped', more: 50 });
  const { html } = await app.get(session, PATH_TO.gallery(job.gallery_id));
  assert.match(html, /150 files were not added:/);
  const skipped = elementByAttr(html, 'data-skipped');
  assert.ok(skipped, 'the skipped-files notice');
  assert.equal(countAttr(skipped, 'data-dismiss'), 1, 'it can be dismissed');
  const items = elementsByTag(skipped, 'li');
  assert.equal(items.length, 101);
  assert.equal(attrsOf(items.at(-1), 'data-skipped-more')?.tag, 'li');
  assert.equal(textOf(items.at(-1)), 'and 50 more files were skipped');
  const named = items.slice(0, -1).map(textOf);
  for (const text of named) assert.match(text, /^bad\d+\.jpg: \S/, 'each of the first 100 items names a skipped file');
  assert.equal(new Set(named.map((text) => text.split(':')[0])).size, 100, '100 different files are named');
  assert.equal(countAttr(skipped, 'data-skipped-more'), 1);
});

test('an unreadable ZIP is refused with its name and creates no gallery', async () => {
  const session = await app.signedIn();
  const before = galleryCount();
  const res = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg'),
    { name: 'broken.zip', data: Buffer.from('not a zip at all') },
  ]);
  assert.equal(res.status, 422);
  assert.match(await res.text(), /broken\.zip: This ZIP file could not be read\./);
  assertNothingStored(before);
});

test('an upload to a full gallery, or with no files, is refused and creates no gallery', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  withLimits(t, app.context, { maxImagesPerGallery: 2 });
  const galleryId = await newGallery(session, jpegs('a.jpg', 'b.jpg'));
  const more = await upload(session, PATH_TO.gallery(galleryId, 'upload'), jpegs('c.jpg'));
  assert.equal(more.status, 413);
  const moreHtml = await more.text();
  assert.match(moreHtml, /This gallery has 2 images and can hold 2; this upload adds 1\./);
  assert.ok(moreHtml.includes(`action="${PATH_TO.gallery(galleryId, 'meta')}"`), 're-renders the edit view');
  const none = await upload(session, PATHS.newGalleryUpload, []);
  assert.equal(none.status, 422);
  assert.match(await none.text(), /Choose at least one image or ZIP file\./);
  assertNothingStored(before + 1);
});

test('a second add-images upload sent before the first job is processed counts the pending images', async (t) => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg'));
  withLimits(t, app.context, { maxImagesPerGallery: 3 });
  const { galleriesService, ingestService, ingestJobs } = app.context;
  const addProcessedImage = galleriesService.addProcessedImage.bind(galleriesService);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  t.mock.method(galleriesService, 'addProcessedImage', async (...args) => {
    await gate;
    return addProcessedImage(...args);
  });
  t.after(async () => {
    release();
    await ingestService.idle();
  });
  const first = await upload(session, PATH_TO.gallery(galleryId, 'upload'), jpegs('b.jpg', 'c.jpg'));
  assert.equal(first.status, 303);
  assert.notEqual(ingestJobs.byId(jobIdFrom(first)).status, 'done');
  assert.equal(imageIds(galleryId).length, 1, 'nothing of the first upload is stored yet');

  const second = await upload(session, PATH_TO.gallery(galleryId, 'upload'), jpegs('d.jpg'));
  assert.equal(second.status, 413);
  assert.match(await second.text(), /This gallery has 3 images and can hold 3; this upload adds 1\./);

  release();
  await ingestService.idle();
  assert.equal(imageIds(galleryId).length, 3);
  assert.deepEqual(tmpFiles(), []);
});

test('two concurrent mixed uploads where only one fits: one is queued, the other refused', async (t) => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg'));
  withLimits(t, app.context, { maxImagesPerGallery: 3 });
  const zip = (await zipFile('race.zip', jpegs('1.jpg', '2.jpg'))).data;
  const { galleriesService, ingestService } = app.context;
  const checkUpload = galleriesService.checkUpload.bind(galleriesService);
  const enqueue = ingestService.enqueue.bind(ingestService);
  let checkedThisTurn = false;
  const sawCheck = [];
  t.mock.method(galleriesService, 'checkUpload', (...args) => {
    checkUpload(...args);
    checkedThisTurn = true;
    queueMicrotask(() => (checkedThisTurn = false));
  });
  t.mock.method(ingestService, 'enqueue', (...args) => {
    sawCheck.push(checkedThisTurn);
    return enqueue(...args);
  });
  const send = () => upload(session, PATH_TO.gallery(galleryId, 'upload'), [{ name: 'r.zip', data: zip }]);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((res) => res.status).sort(), [303, 413]);
  await Promise.all(results.map((res) => res.arrayBuffer()));
  assert.deepEqual(sawCheck, [true], 'the queued upload was checked right before it was queued');
  await ingestService.idle();
  assert.equal(imageIds(galleryId).length, 3);
  assert.deepEqual(tmpFiles(), []);
});

test('a new-gallery upload whose job cannot be queued leaves no gallery and no temp file behind', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  const jobsBefore = rowCount(app.context.db, 'ingest_jobs');
  t.mock.method(app.context.ingestService, 'enqueue', () => {
    throw new Error('database is locked');
  });
  const res = await upload(session, PATHS.newGalleryUpload, [
    ...jpegs('a.jpg'),
    await zipFile('z.zip', jpegs('1.jpg')),
  ]);
  assert.equal(res.status, 500);
  await res.arrayBuffer();
  assertNothingStored(before);
  assert.equal(rowCount(app.context.db, 'ingest_jobs'), jobsBefore);
});

test('a new-gallery upload whose job insert fails rolls the gallery back as well', async (t) => {
  const session = await app.signedIn();
  const before = galleryCount();
  t.mock.method(app.context.ingestJobs, 'insert', () => {
    throw new Error('disk I/O error');
  });
  const res = await upload(session, PATHS.newGalleryUpload, jpegs('a.jpg', 'b.jpg'));
  assert.equal(res.status, 500);
  await res.arrayBuffer();
  assertNothingStored(before);
});

test('an add-images upload whose job cannot be queued queues nothing and leaves no temp file behind', async (t) => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg'));
  const jobsBefore = rowCount(app.context.db, 'ingest_jobs', 'gallery_id = ?', galleryId);
  t.mock.method(app.context.ingestService, 'enqueue', () => {
    throw new Error('database is locked');
  });
  const res = await upload(session, PATH_TO.gallery(galleryId, 'upload'), jpegs('b.jpg'));
  assert.equal(res.status, 500);
  await res.arrayBuffer();
  assert.equal(rowCount(app.context.db, 'ingest_jobs', 'gallery_id = ?', galleryId), jobsBefore);
  assert.equal(imageIds(galleryId).length, 1);
  assert.deepEqual(tmpFiles(), []);
});

test('a gallery moved to Trash while its upload is inspected is refused with 404 before anything is queued', async (t) => {
  const owner = await app.signedIn();
  const galleryId = await newGallery(owner, jpegs('a.jpg'));
  const jobsBefore = rowCount(app.context.db, 'ingest_jobs', 'gallery_id = ?', galleryId);
  const { galleriesService, ingestService } = app.context;
  const openReadStream = yauzl.ZipFile.prototype.openReadStream;
  let trashed = false;
  t.mock.method(yauzl.ZipFile.prototype, 'openReadStream', function (...args) {
    if (!trashed) {
      trashed = true;
      galleriesService.trash(owner.user, galleryId);
    }
    return openReadStream.apply(this, args);
  });
  const enqueue = t.mock.method(ingestService, 'enqueue');
  const res = await upload(owner, PATH_TO.gallery(galleryId, 'upload'), [await zipFile('z.zip', jpegs('1.jpg'))]);
  assert.equal(res.status, 404);
  await res.arrayBuffer();
  assert.ok(trashed, 'the gallery was trashed during inspection');
  assert.equal(enqueue.mock.callCount(), 0, 'the access check after inspection refuses it before the enqueue');
  assert.equal(rowCount(app.context.db, 'ingest_jobs', 'gallery_id = ?', galleryId), jobsBefore);
  assert.equal(imageIds(galleryId).length, 1);
  assert.deepEqual(tmpFiles(), []);
});

test("an admin adding to another user's gallery is held to the owner's quota", async (t) => {
  const owner = await app.signedIn();
  const galleryId = await newGallery(owner, jpegs('a.jpg'));
  const admin = await app.signedIn({ role: 'admin' });
  withLimits(t, app.context, { userQuotaMb: 1 });
  const [stored] = app.context.galleryImages.forGallery(galleryId);
  app.context.galleryImages.setBytes(stored.id, { bytesOrig: 900 * 1024, bytesWeb: 0, bytesThumb: 0 });
  const over = await upload(admin, PATH_TO.gallery(galleryId, 'upload'), [
    { name: 'big.jpg', data: Buffer.concat([jpeg, Buffer.alloc(200 * 1024)]) },
  ]);
  assert.equal(over.status, 413);
  assert.match(await over.text(), /This upload would use \d+(\.\d+)? MB of the gallery owner&#39;s 1 MB storage\./);
  const fits = await upload(admin, PATH_TO.gallery(galleryId, 'upload'), jpegs('small.jpg'));
  assert.equal(fits.status, 303);
  await app.context.ingestService.idle();
  assert.equal(imageIds(galleryId).length, 2);
  assert.deepEqual(tmpFiles(), []);
});

test('loose images alone over the room left refuse the upload before any ZIP is opened', async (t) => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg', 'b.jpg'));
  withLimits(t, app.context, { maxImagesPerGallery: 3 });
  const zip = await zipFile('z.zip', jpegs('1.jpg'));
  const opened = t.mock.method(yauzl, 'open');
  const res = await upload(session, PATH_TO.gallery(galleryId, 'upload'), [...jpegs('c.jpg', 'd.jpg'), zip]);
  assert.equal(res.status, 413);
  assert.match(await res.text(), /This gallery has 2 images and can hold 3; this upload adds more than 1\./);
  assert.equal(opened.mock.callCount(), 0, 'no ZIP is opened');
  assert.equal(imageIds(galleryId).length, 2);
  assert.deepEqual(tmpFiles(), []);
});
