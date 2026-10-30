import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mediaContext } from '../helpers/context.js';
import { insertBareUserRow } from '../helpers/accounts.js';
import { rowCount } from '../helpers/db.js';
import { recordingLogger } from '../helpers/logger.js';
import { makeJpeg } from '../helpers/images.js';
import { writeZip } from '../helpers/zip.js';
import { setLimit } from '../helpers/uploads.js';
import { LimitExceededError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { NO_FILES, NO_USABLE_IMAGES } from '../../services/upload-intake.service.js';

let fixture;
let jpeg;
beforeEach(async (t) => {
  const { tmp, db, context } = mediaContext(t, { prefix: 'gs-intake-' });
  const owner = insertBareUserRow(context, { email: 'o@x.co' });
  const stranger = insertBareUserRow(context, { email: 's@x.co' });
  jpeg ??= await makeJpeg();
  fixture = { tmp, db, context, owner, stranger, intake: context.uploadIntake };
  t.after(() => context.ingestService.idle());
});

let fileCounter = 0;
function uploaded(originalname, data) {
  const file = path.join(fixture.tmp, `upload-${++fileCounter}`);
  fs.writeFileSync(file, data);
  return { path: file, originalname, size: data.length };
}

async function uploadedZip(originalname, entries) {
  const file = await writeZip(path.join(fixture.tmp, `upload-${++fileCounter}`), entries);
  return { path: file, originalname, size: fs.statSync(file).size };
}

const galleryCount = () => rowCount(fixture.db, 'galleries');
const tmpLeft = () => fs.readdirSync(fixture.tmp);

test('inspect counts loose images and sniffed ZIP entries, and lists fake entries as skipped', async () => {
  const files = [
    uploaded('a.jpg', jpeg),
    await uploadedZip('z.zip', [
      { name: 'x/1.jpg', data: jpeg },
      { name: 'fake.jpg', data: 'text' },
    ]),
  ];
  const { count, bytes, source } = await fixture.intake.inspect(files, { existing: false, have: 0 });
  assert.equal(count, 2);
  assert.equal(bytes, 2 * jpeg.length);
  assert.deepEqual(source.files, [{ path: files[0].path, originalName: 'a.jpg' }]);
  assert.deepEqual(source.zips, [{ path: files[1].path, originalName: 'z.zip', names: ['x/1.jpg'] }]);
  assert.deepEqual(source.skipped, [{ name: 'z.zip/fake.jpg', reason: 'Not a JPEG, PNG or WebP image.' }]);
});

test('createGalleryFromUpload creates the gallery and queues one job with the upload', async () => {
  const before = galleryCount();
  const jobId = await fixture.intake.createGalleryFromUpload(fixture.owner, [uploaded('a.jpg', jpeg)]);
  const job = fixture.context.ingestJobs.byId(jobId);
  assert.equal(galleryCount(), before + 1);
  assert.equal(job.user_id, fixture.owner.id);
  assert.equal(fixture.context.galleries.liveById(job.gallery_id).user_id, fixture.owner.id);
  assert.equal(job.total, 1);
  await fixture.context.ingestService.idle();
  assert.equal(fixture.context.galleryImages.forGallery(job.gallery_id).length, 1);
  assert.deepEqual(tmpLeft(), []);
});

test('when enqueue throws, no gallery row is left and the temp files are deleted', async (t) => {
  const before = galleryCount();
  t.mock.method(fixture.context.ingestService, 'enqueue', () => {
    throw new Error('database is locked');
  });
  const files = [uploaded('a.jpg', jpeg), await uploadedZip('z.zip', [{ name: '1.jpg', data: jpeg }])];
  await assert.rejects(fixture.intake.createGalleryFromUpload(fixture.owner, files), /database is locked/);
  assert.equal(galleryCount(), before, 'the gallery insert is rolled back');
  assert.equal(rowCount(fixture.db, 'ingest_jobs'), 0);
  assert.deepEqual(tmpLeft(), []);
});

test('a rolled-back upload leaves no Gallery created row and logs no Gallery created line', async (t) => {
  const { logger, info } = recordingLogger();
  const { tmp, db, context } = mediaContext(t, { prefix: 'gs-intake-log-', logger });
  t.after(() => context.ingestService.idle());
  const owner = insertBareUserRow(context, { email: 'o@x.co' });
  t.mock.method(context.ingestService, 'enqueue', () => {
    throw new Error('database is locked');
  });
  const file = path.join(tmp, 'upload-rollback');
  fs.writeFileSync(file, jpeg);
  const upload = [{ path: file, originalname: 'a.jpg', size: jpeg.length }];
  await assert.rejects(context.uploadIntake.createGalleryFromUpload(owner, upload), /database is locked/);
  assert.equal(rowCount(db, 'activity'), 0, 'the activity row rolls back with the gallery');
  assert.deepEqual(
    info.filter(([message]) => message === 'Gallery created'),
    [],
    'the log line is dropped with the rollback',
  );
});

test('a committed upload logs its Gallery created line once', async (t) => {
  const { logger, info } = recordingLogger();
  const { tmp, context } = mediaContext(t, { prefix: 'gs-intake-log-', logger });
  t.after(() => context.ingestService.idle());
  const owner = insertBareUserRow(context, { email: 'o@x.co' });
  const file = path.join(tmp, 'upload-commit');
  fs.writeFileSync(file, jpeg);
  await context.uploadIntake.createGalleryFromUpload(owner, [{ path: file, originalname: 'a.jpg', size: jpeg.length }]);
  assert.equal(info.filter(([message]) => message === 'Gallery created').length, 1);
});

test('a refused upload creates nothing and deletes its temp files', async () => {
  const before = galleryCount();
  await assert.rejects(fixture.intake.createGalleryFromUpload(fixture.owner, []), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.publicMessage, NO_FILES);
    return true;
  });
  const fake = await uploadedZip('fake.zip', [{ name: 'fake.jpg', data: 'text' }]);
  await assert.rejects(fixture.intake.createGalleryFromUpload(fixture.owner, [fake]), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.publicMessage, NO_USABLE_IMAGES);
    return true;
  });
  setLimit(fixture.context, 'maxImagesPerGallery', 1);
  const two = [uploaded('a.jpg', jpeg), uploaded('b.jpg', jpeg)];
  await assert.rejects(fixture.intake.createGalleryFromUpload(fixture.owner, two), LimitExceededError);
  assert.equal(galleryCount(), before);
  assert.deepEqual(tmpLeft(), []);
});

test('a temp file that cannot be removed is logged and never replaces the refusal the user should see', async (t) => {
  const { logger, warn } = recordingLogger();
  const { tmp, context } = mediaContext(t, { prefix: 'gs-intake-rm-', logger });
  t.after(() => context.ingestService.idle());
  const owner = insertBareUserRow(context, { email: 'o@x.co' });
  setLimit(context, 'maxImagesPerGallery', 1);
  const stuck = path.join(tmp, 'upload-stuck');
  fs.mkdirSync(stuck);
  fs.writeFileSync(path.join(stuck, 'inside'), 'x');
  const loose = path.join(tmp, 'upload-loose');
  fs.writeFileSync(loose, jpeg);
  const two = [
    { path: loose, originalname: 'a.jpg', size: jpeg.length },
    { path: stuck, originalname: 'b.jpg', size: jpeg.length },
  ];
  await assert.rejects(context.uploadIntake.createGalleryFromUpload(owner, two), LimitExceededError);
  assert.equal(fs.existsSync(loose), false, 'the other file is still removed');
  assert.deepEqual(
    warn.map(([message]) => message),
    ['temp file not removed'],
  );
});

test('addUploadToGallery queues a job on the gallery and refuses a stranger with NotFoundError', async () => {
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  const jobId = await fixture.intake.addUploadToGallery(fixture.owner, galleryId, [uploaded('a.jpg', jpeg)]);
  assert.equal(fixture.context.ingestJobs.byId(jobId).gallery_id, galleryId);
  await fixture.context.ingestService.idle();
  await assert.rejects(
    fixture.intake.addUploadToGallery(fixture.stranger, galleryId, [uploaded('b.jpg', jpeg)]),
    NotFoundError,
  );
  assert.equal(rowCount(fixture.db, 'ingest_jobs', 'gallery_id = ?', galleryId), 1);
  assert.deepEqual(tmpLeft(), []);
});
