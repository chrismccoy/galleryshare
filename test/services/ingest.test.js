import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { activityRows } from '../helpers/activity.js';
import fs from 'node:fs';
import path from 'node:path';
import { mediaContext } from '../helpers/context.js';
import { insertBareUserRow } from '../helpers/accounts.js';
import { recordingLogger } from '../helpers/logger.js';
import { rowCount } from '../helpers/db.js';
import { distinctJpegs, makeJpeg, makePng, picture } from '../helpers/images.js';
import { writeZip } from '../helpers/zip.js';
import { createIngestService } from '../../services/ingest.service.js';
import { NotFoundError } from '../../lib/errors.js';

let fixture;
beforeEach((t) => {
  const { root, tmp, db, context } = mediaContext(t, { prefix: 'gs-ingest-' });
  const owner = insertBareUserRow(context, { email: 'o@x.co' });
  fixture = { root, tmp, db, context, owner, service: context.ingestService };
});

let fileCounter = 0;
function tempFile(data) {
  const file = path.join(fixture.tmp, `upload-${++fileCounter}`);
  fs.writeFileSync(file, data);
  return file;
}

const imagesOf = (galleryId) => fixture.context.galleryImages.forGallery(galleryId);

async function run(
  source,
  { galleryId = fixture.context.galleriesService.create(fixture.owner), service = fixture.service } = {},
) {
  const jobId = service.enqueue({ userId: fixture.owner.id, galleryId, source });
  await service.idle();
  return { jobId, galleryId, job: fixture.context.ingestJobs.byId(jobId) };
}

test('a batch with one corrupt file keeps the good images and lists the bad one by name', async () => {
  const good = await makeJpeg({ width: 600, height: 400, quality: 95 });
  const { job, galleryId } = await run({
    zips: [],
    files: [
      { path: tempFile(good), originalName: 'good.jpg' },
      { path: tempFile('just some notes'), originalName: 'notes.jpg' },
      { path: tempFile(good.subarray(0, Math.floor(good.length / 2))), originalName: 'truncated.jpg' },
    ],
  });
  assert.equal(job.status, 'done');
  assert.equal(job.total, 3);
  assert.equal(job.processed, 3);
  assert.deepEqual(job.skipped, [
    { name: 'notes.jpg', reason: 'Use a JPEG, PNG or WebP photo.' },
    { name: 'truncated.jpg', reason: 'This image could not be read.' },
  ]);
  assert.ok(job.finished_at);
  assert.deepEqual(
    imagesOf(galleryId).map((i) => i.original_name),
    ['good.jpg'],
  );
});

test('a resized copy of an image in the same upload is skipped as a duplicate', async () => {
  const original = await picture(1).jpeg({ quality: 95 }).toBuffer();
  const smaller = await picture(1).resize(300).png().toBuffer();
  const other = await picture(2).jpeg().toBuffer();
  const { job, galleryId } = await run({
    zips: [],
    files: [
      { path: tempFile(original), originalName: 'a.jpg' },
      { path: tempFile(smaller), originalName: 'b.png' },
      { path: tempFile(other), originalName: 'c.jpg' },
    ],
  });
  assert.equal(job.status, 'done');
  assert.deepEqual(
    imagesOf(galleryId).map((row) => row.original_name),
    ['a.jpg', 'c.jpg'],
  );
  assert.deepEqual(job.skipped, [{ name: 'b.png', reason: 'Already in this gallery.' }]);
});

test('an image already in the gallery is skipped; the same image goes into another gallery', async () => {
  const photo = await picture(3).jpeg().toBuffer();
  const { galleryId } = await run({ zips: [], files: [{ path: tempFile(photo), originalName: 'first.jpg' }] });
  const again = await run({ zips: [], files: [{ path: tempFile(photo), originalName: 'again.jpg' }] }, { galleryId });
  assert.deepEqual(again.job.skipped, [{ name: 'again.jpg', reason: 'Already in this gallery.' }]);
  assert.equal(imagesOf(galleryId).length, 1);
  const elsewhere = await run({ zips: [], files: [{ path: tempFile(photo), originalName: 'first.jpg' }] });
  assert.equal(imagesOf(elsewhere.galleryId).length, 1, 'other galleries are not checked');
  assert.match(imagesOf(galleryId)[0].phash, /^[0-9a-f]{16}$/, 'the hash is stored with the image');
});

test('images are added in natural filename order (img2 before img10)', async () => {
  const names = ['img10.jpg', 'IMG1.jpg', 'img2.jpg', 'img9.jpg'];
  const { galleryId, job } = await run({
    zips: [],
    files: (await distinctJpegs(names.length)).map((data, i) => ({ path: tempFile(data), originalName: names[i] })),
  });
  assert.equal(job.status, 'done');
  assert.deepEqual(
    imagesOf(galleryId).map((i) => i.original_name),
    ['IMG1.jpg', 'img2.jpg', 'img9.jpg', 'img10.jpg'],
  );
});

test('a ZIP job imports images by basename in natural path order and lists bad entries as zip/basename', async () => {
  const zip = await writeZip(path.join(fixture.tmp, 'upload.zip'), [
    { name: 'b/img10.jpg', data: await makeJpeg() },
    { name: 'a/img2.png', data: await makePng({ width: 8, height: 8 }) },
    { name: 'a/bad.jpg', data: 'not an image' },
    { name: 'img1.jpg', data: await makeJpeg() },
  ]);
  const { galleryId, job } = await run({
    files: [],
    zips: [{ path: zip, originalName: 'trip.zip', names: ['b/img10.jpg', 'a/img2.png', 'a/bad.jpg', 'img1.jpg'] }],
  });
  assert.equal(job.status, 'done');
  assert.equal(job.processed, 4);
  assert.deepEqual(job.skipped, [{ name: 'trip.zip/bad.jpg', reason: 'Use a JPEG, PNG or WebP photo.' }]);
  assert.deepEqual(
    imagesOf(galleryId).map((i) => i.original_name),
    ['img2.png', 'img10.jpg', 'img1.jpg'],
  );
  assert.equal(fs.existsSync(zip), false, 'the uploaded ZIP is deleted');
});

test('ZIP entries follow natural order of the full path, not the archive order, so folders stay together', async () => {
  const zip = await writeZip(path.join(fixture.tmp, 'folders.zip'), [
    { name: 'def/3.jpg', data: await makeJpeg() },
    { name: 'abc/10.jpg', data: await makeJpeg() },
    { name: 'def/1.jpg', data: await makeJpeg() },
    { name: 'a.jpg', data: await makeJpeg() },
    { name: 'abc/2.jpg', data: await makeJpeg() },
  ]);
  const names = ['def/3.jpg', 'abc/10.jpg', 'def/1.jpg', 'a.jpg', 'abc/2.jpg'];
  const { galleryId, job } = await run({ files: [], zips: [{ path: zip, originalName: 'folders.zip', names }] });
  assert.equal(job.status, 'done');
  assert.deepEqual(
    imagesOf(galleryId).map((i) => i.original_name),
    ['a.jpg', '2.jpg', '10.jpg', '1.jpg', '3.jpg'],
  );
});

test('a mixed job adds loose images first, then each ZIP in natural order of its name, and lists upload-time skips first', async () => {
  const png = await makePng({ width: 8, height: 8 });
  const zip10 = await writeZip(path.join(fixture.tmp, 'z10.zip'), [
    { name: 'x/b.jpg', data: await makeJpeg() },
    { name: 'x/a.jpg', data: await makeJpeg() },
  ]);
  const zip2 = await writeZip(path.join(fixture.tmp, 'z2.zip'), [
    { name: 'deep/folder/p2.png', data: png },
    { name: 'p1.jpg', data: await makeJpeg() },
    { name: 'junk.jpg', data: 'not an image' },
  ]);
  const skipped = [{ name: 'pics10.zip/fake.jpg', reason: 'Not a JPEG, PNG or WebP image.' }];
  const storedSkipped = skipped.map((item) => ({ ...item, atUpload: true }));
  const { galleryId, job } = await run({
    files: [
      { path: tempFile(await makeJpeg()), originalName: 'loose10.jpg' },
      { path: tempFile(await makeJpeg()), originalName: 'loose2.jpg' },
    ],
    zips: [
      { path: zip10, originalName: 'pics10.zip', names: ['x/b.jpg', 'x/a.jpg'] },
      { path: zip2, originalName: 'pics2.zip', names: ['deep/folder/p2.png', 'p1.jpg', 'junk.jpg'] },
    ],
    skipped,
  });
  assert.equal(job.status, 'done');
  assert.equal(job.total, 7);
  assert.equal(job.processed, 7);
  assert.deepEqual(
    imagesOf(galleryId).map((i) => i.original_name),
    ['loose2.jpg', 'loose10.jpg', 'p2.png', 'p1.jpg', 'a.jpg', 'b.jpg'],
  );
  assert.deepEqual(job.skipped, [
    ...storedSkipped,
    { name: 'pics2.zip/junk.jpg', reason: 'Use a JPEG, PNG or WebP photo.' },
  ]);
  assert.deepEqual(fs.readdirSync(fixture.tmp), [], 'every temp file is deleted');
});

test('recover() fails unfinished jobs with the restart message', async () => {
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  const pending = fixture.context.ingestJobs.insert({ userId: fixture.owner.id, galleryId, total: 2 });
  const running = fixture.context.ingestJobs.insert({ userId: fixture.owner.id, galleryId, total: 3 });
  fixture.context.ingestJobs.setRunning(running);
  const done = fixture.context.ingestJobs.insert({ userId: fixture.owner.id, galleryId, total: 1 });
  fixture.context.ingestJobs.setRunning(done);
  fixture.context.ingestJobs.setDone(done);
  assert.equal(fixture.service.recover(), 2);
  for (const id of [pending, running]) {
    const row = fixture.context.ingestJobs.byId(id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error, 'Interrupted by restart. Upload the remaining images again.');
  }
  assert.equal(fixture.context.ingestJobs.byId(done).status, 'done');
});

test('temp files are deleted after processing', async () => {
  const files = [
    { path: tempFile(await makeJpeg()), originalName: 'a.jpg' },
    { path: tempFile('junk'), originalName: 'b.jpg' },
  ];
  const { job } = await run({ files, zips: [] });
  assert.equal(job.status, 'done');
  assert.deepEqual(fs.readdirSync(fixture.tmp), []);
});

test('enqueue rejects a missing or trashed gallery and deletes the uploaded files', async () => {
  const trashed = fixture.context.galleriesService.create(fixture.owner);
  fixture.context.galleriesService.trash(fixture.owner, trashed);
  for (const galleryId of [9999, trashed]) {
    const file = tempFile(await makeJpeg());
    assert.throws(
      () =>
        fixture.service.enqueue({
          userId: fixture.owner.id,
          galleryId,
          source: { files: [{ path: file, originalName: 'a.jpg' }], zips: [] },
        }),
      NotFoundError,
    );
    await fixture.service.idle();
    assert.equal(fs.existsSync(file), false);
  }
  assert.equal(rowCount(fixture.db, 'ingest_jobs'), 0);
});

test('the job finishing marks the gallery edited once with the uploader as actor', async () => {
  const admin = insertBareUserRow(fixture.context, { email: 'a@x.co', role: 'admin' });
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  const touches = [];
  const galleriesService = {
    ...fixture.context.galleriesService,
    markEdited: (id, actorId) => touches.push([id, actorId]),
  };
  const service = createIngestService({ ...fixture.context, galleriesService, logger: recordingLogger().logger });
  const jobId = service.enqueue({
    userId: admin.id,
    galleryId,
    source: {
      zips: [],
      files: [
        { path: tempFile(await makeJpeg()), originalName: 'a.jpg' },
        { path: tempFile(await makeJpeg()), originalName: 'b.jpg' },
      ],
    },
  });
  await service.idle();
  assert.equal(fixture.context.ingestJobs.byId(jobId).status, 'done');
  assert.deepEqual(touches, [[galleryId, admin.id]]);
});

test('a gallery trashed mid-job fails the job and stops adding images', async () => {
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  let added = 0;
  const galleriesService = {
    ...fixture.context.galleriesService,
    async addProcessedImage(...args) {
      const id = await fixture.context.galleriesService.addProcessedImage(...args);
      added += 1;
      if (added === 1) fixture.context.galleriesService.trash(fixture.owner, galleryId);
      return id;
    },
  };
  const service = createIngestService({ ...fixture.context, galleriesService, logger: recordingLogger().logger });
  const jobId = service.enqueue({
    userId: fixture.owner.id,
    galleryId,
    source: {
      zips: [],
      files: (await distinctJpegs(3)).map((data, i) => ({ path: tempFile(data), originalName: `${i + 1}.jpg` })),
    },
  });
  await service.idle();
  const job = fixture.context.ingestJobs.byId(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'The gallery was deleted before all images were added.');
  assert.equal(job.processed, 1);
  assert.equal(added, 1);
  assert.deepEqual(fs.readdirSync(fixture.tmp), []);
});

test('a job whose owner was disabled before it started is cancelled: no images, its temp files go', async () => {
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  const file = tempFile(await makeJpeg());
  const jobId = fixture.service.enqueue({
    userId: fixture.owner.id,
    galleryId,
    source: { zips: [], files: [{ path: file, originalName: 'a.jpg' }] },
  });
  fixture.context.users.setDisabled(fixture.owner.id, true);
  await fixture.service.idle();
  const job = fixture.context.ingestJobs.byId(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'Cancelled because the account is no longer active.');
  assert.deepEqual(imagesOf(galleryId), []);
  assert.deepEqual(fs.readdirSync(fixture.tmp), []);
});

test('takeFinishedNotice gives a finished job once, and nothing while another job of the gallery is unfinished', async () => {
  const { galleryId, job } = await run({
    zips: [],
    files: [{ path: tempFile('just some notes'), originalName: 'notes.jpg' }],
  });
  const waiting = fixture.context.ingestJobs.insert({ userId: fixture.owner.id, galleryId, total: 1 });
  assert.equal(fixture.service.takeFinishedNotice(galleryId), null, 'held back while a job is unfinished');
  fixture.context.ingestJobs.setFailed(waiting, 'stopped');
  assert.equal(fixture.service.takeFinishedNotice(galleryId).id, job.id);
  assert.equal(fixture.service.takeFinishedNotice(galleryId), null, 'shown once');
});

test('enqueue stores the upload byte total on the job; it defaults to 0', async () => {
  const galleryId = fixture.context.galleriesService.create(fixture.owner);
  const withBytes = fixture.service.enqueue({
    userId: fixture.owner.id,
    galleryId,
    source: { files: [{ path: tempFile(await makeJpeg()), originalName: 'a.jpg' }], zips: [] },
    bytes: 1234,
  });
  const without = fixture.service.enqueue({
    userId: fixture.owner.id,
    galleryId,
    source: { files: [{ path: tempFile(await makeJpeg()), originalName: 'b.jpg' }], zips: [] },
  });
  assert.equal(fixture.context.ingestJobs.byId(withBytes).bytes, 1234);
  assert.equal(fixture.context.ingestJobs.byId(without).bytes, 0);
  await fixture.service.idle();
});

test('jobForViewer: the job user, or anyone who may manage its gallery (Trash included); activeForGallery', () => {
  const { context, owner } = fixture;
  const other = insertBareUserRow(context, { email: 'other@x.co' });
  const admin = insertBareUserRow(context, { email: 'admin@x.co', role: 'admin' });
  const galleryId = context.galleriesService.create(owner);
  const ownJob = context.ingestJobs.insert({ userId: owner.id, galleryId, total: 1 });
  const adminJob = context.ingestJobs.insert({ userId: admin.id, galleryId, total: 1 });
  assert.equal(fixture.service.activeForGallery(galleryId).id, adminJob);
  for (const jobId of [ownJob, adminJob]) {
    assert.equal(fixture.service.jobForViewer(owner, jobId).id, jobId);
    assert.equal(fixture.service.jobForViewer(admin, jobId).id, jobId);
    assert.equal(fixture.service.jobForViewer(other, jobId), null);
  }
  assert.equal(fixture.service.jobForViewer(owner, 999999), null);
  context.galleriesService.trash(owner, galleryId);
  assert.equal(fixture.service.jobForViewer(owner, ownJob).id, ownJob);
  assert.equal(fixture.service.jobForViewer(admin, ownJob).id, ownJob);
  assert.equal(fixture.service.jobForViewer(other, ownJob), null);
  const othersGallery = context.galleriesService.create(owner);
  const byOther = context.ingestJobs.insert({ userId: other.id, galleryId: othersGallery, total: 1 });
  assert.equal(fixture.service.jobForViewer(other, byOther).id, byOther);
  context.ingestJobs.setFailed(byOther, 'Stopped.');
  assert.equal(fixture.service.activeForGallery(othersGallery), null);
});

test('a server-side failure is logged with its message and code, and the image is listed as skipped', async () => {
  const recording = recordingLogger();
  const galleriesService = {
    ...fixture.context.galleriesService,
    addProcessedImage: async () => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    },
  };
  const service = createIngestService({ ...fixture.context, galleriesService, logger: recording.logger });
  const { job } = await run(
    { zips: [], files: [{ path: tempFile(await makeJpeg()), originalName: 'a.jpg' }] },
    { service },
  );
  assert.equal(job.status, 'done');
  assert.equal(job.skipped.length, 1);
  assert.deepEqual(recording.error, [
    ['ingest item failed', { jobId: job.id, error: 'no space left on device', code: 'ENOSPC' }],
  ]);
});

test('the ingest service exposes exactly these methods, and no internal scheduling hook', () => {
  assert.deepEqual(Object.keys(fixture.service).sort(), [
    'activeForGallery',
    'enqueue',
    'idle',
    'jobForViewer',
    'recover',
    'size',
    'takeFinishedNotice',
  ]);
});

test('a job that stops being pending between its read and setRunning is not run, and its temp files go', async () => {
  const { ingestJobs } = fixture.context;
  const racing = {
    ...ingestJobs,
    setRunning: (id) => {
      ingestJobs.setFailed(id, 'finished elsewhere');
      return ingestJobs.setRunning(id);
    },
  };
  const service = createIngestService({ ...fixture.context, ingestJobs: racing, logger: recordingLogger().logger });
  const file = tempFile(await makeJpeg());
  const { job, galleryId } = await run({ zips: [], files: [{ path: file, originalName: 'a.jpg' }] }, { service });
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'finished elsewhere');
  assert.equal(job.processed, 0);
  assert.deepEqual(imagesOf(galleryId), [], 'no image was added');
  assert.equal(fs.existsSync(file), false);
});

test('activity: a finished job records imagesAdded with added and skipped counts, by the uploader', async () => {
  const good = await makeJpeg({ width: 600, height: 400, quality: 95 });
  await run({
    zips: [],
    files: [
      { path: tempFile(good), originalName: 'good.jpg' },
      { path: tempFile('just some notes'), originalName: 'notes.jpg' },
    ],
    skipped: [{ name: 'readme.txt', reason: 'Not an image.' }],
  });
  const rows = activityRows(fixture.context, 'imagesAdded');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details, '1 added, 2 skipped');
  assert.equal(rows[0].actor_id, fixture.owner.id);
  assert.equal(rows[0].subject_user_id, null);
});

test('activity: an image whose row went away during the write is not counted as added', async () => {
  let calls = 0;
  const galleriesService = {
    ...fixture.context.galleriesService,
    async addProcessedImage(...args) {
      calls += 1;
      return calls === 1 ? fixture.context.galleriesService.addProcessedImage(...args) : null;
    },
  };
  const service = createIngestService({ ...fixture.context, galleriesService, logger: recordingLogger().logger });
  const files = (await distinctJpegs(2)).map((data, i) => ({ path: tempFile(data), originalName: `${i + 1}.jpg` }));
  const { job } = await run({ zips: [], files }, { service });
  assert.equal(job.status, 'done');
  assert.equal(job.processed, 2);
  assert.deepEqual(
    activityRows(fixture.context, 'imagesAdded').map((row) => row.details),
    ['1 added'],
  );
});

test('activity: a job that added and skipped nothing records nothing; only skipped items are reported alone', async () => {
  const { galleryId } = await run({
    zips: [],
    files: [{ path: tempFile('just some notes'), originalName: 'notes.jpg' }],
  });
  const rows = activityRows(fixture.context, 'imagesAdded');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details, '1 skipped');
  assert.equal(rows[0].gallery_id, galleryId);
});
