import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { insertBareUser } from '../helpers/accounts.js';
import { fakeClock } from '../helpers/clock.js';
import { createGalleriesRepository } from '../../db/galleries.repository.js';
import { createIngestJobsRepository } from '../../db/ingest-jobs.repository.js';
import { INGEST_STATUS } from '../../domain/ingest.js';

function setup() {
  const db = freshDb();
  const userId = insertBareUser(db, { email: 'o@example.com' });
  const clock = fakeClock('2026-10-28T10:00:00.000Z');
  const galleries = createGalleriesRepository(db, { now: clock.now });
  const galleryId = galleries.insert({ userId });
  const otherGalleryId = galleries.insert({ userId });
  const jobs = createIngestJobsRepository(db, { now: clock.now });
  return { jobs, userId, galleryId, otherGalleryId, clock };
}

test('a job is stamped from the clock as it is created, started and finished', () => {
  const { jobs, userId, galleryId, clock } = setup();
  const id = jobs.insert({ userId, galleryId, total: 3 });
  let job = jobs.byId(id);
  assert.equal(job.status, INGEST_STATUS.pending);
  assert.equal(job.created_at, '2026-10-28T10:00:00.000Z');
  assert.equal(job.bytes, 0, 'bytes default to 0');
  assert.deepEqual(job.skipped, []);
  clock.tick(1000);
  assert.equal(jobs.setRunning(id), true);
  assert.equal(jobs.byId(id).started_at, '2026-10-28T10:00:01.000Z');
  clock.tick(1000);
  assert.equal(jobs.setDone(id), true);
  job = jobs.byId(id);
  assert.equal(job.status, INGEST_STATUS.done);
  assert.equal(job.finished_at, '2026-10-28T10:00:02.000Z');
});

test('only a pending job starts, and only an unfinished job records progress or finishes', () => {
  const { jobs, userId, galleryId } = setup();
  const id = jobs.insert({ userId, galleryId, total: 2 });
  assert.equal(jobs.setRunning(id), true);
  assert.equal(jobs.setRunning(id), false, 'a running job is not started again');
  assert.equal(jobs.progress(id, 1, [{ name: 'a.jpg', reason: 'bad' }]), true);
  assert.deepEqual(jobs.byId(id).skipped, [{ name: 'a.jpg', reason: 'bad' }]);
  assert.equal(jobs.setFailed(id, 'stopped'), true);
  assert.equal(jobs.byId(id).error, 'stopped');
  assert.equal(jobs.setDone(id), false, 'a finished job keeps its outcome');
  assert.equal(jobs.progress(id, 2, []), false);
  assert.equal(jobs.byId(id).status, INGEST_STATUS.failed);
  assert.equal(jobs.byId(id).processed, 1);
  assert.equal(jobs.setRunning(jobs.insert({ userId, galleryId, total: 1 })), true, 'a new job starts');
});

test('unfinished lists pending and running jobs, oldest first; activeForGallery gives the latest of one gallery', () => {
  const { jobs, userId, galleryId, otherGalleryId } = setup();
  const done = jobs.insert({ userId, galleryId, total: 1 });
  jobs.setDone(done);
  const running = jobs.insert({ userId, galleryId, total: 1 });
  jobs.setRunning(running);
  const pending = jobs.insert({ userId, galleryId, total: 1 });
  const elsewhere = jobs.insert({ userId, galleryId: otherGalleryId, total: 1 });
  assert.deepEqual(
    jobs.unfinished().map((job) => job.id),
    [running, pending, elsewhere],
  );
  assert.equal(jobs.activeForGallery(galleryId).id, pending);
  jobs.setDone(running);
  jobs.setDone(pending);
  assert.equal(jobs.activeForGallery(galleryId), null);
});

test('the work still reserved counts only unfinished jobs: images left per gallery, upload bytes per owner', () => {
  const { jobs, userId, galleryId, otherGalleryId } = setup();
  const first = jobs.insert({ userId, galleryId, total: 5, bytes: 1000 });
  jobs.setRunning(first);
  jobs.progress(first, 2, []);
  jobs.insert({ userId, galleryId: otherGalleryId, total: 4, bytes: 500 });
  const finished = jobs.insert({ userId, galleryId, total: 9, bytes: 9000 });
  jobs.setDone(finished);
  assert.equal(jobs.pendingImages(galleryId), 3, '5 to add, 2 handled; the finished job counts nothing');
  assert.equal(jobs.pendingImages(otherGalleryId), 4);
  assert.equal(jobs.pendingBytesForUser(userId), 1500);
  jobs.setFailed(first, 'stopped');
  assert.equal(jobs.pendingImages(galleryId), 0);
  assert.equal(jobs.pendingBytesForUser(userId), 500);
  assert.equal(jobs.pendingBytesForUser(userId + 1), 0, 'another owner reserves nothing');
});

test('pendingNotice gives the latest done job that skipped images, until its notice is marked shown once', () => {
  const { jobs, userId, galleryId, clock } = setup();
  const clean = jobs.insert({ userId, galleryId, total: 1 });
  jobs.setDone(clean);
  assert.equal(jobs.pendingNotice(galleryId), null, 'a job that skipped nothing has no notice');
  const older = jobs.insert({ userId, galleryId, total: 1 });
  jobs.progress(older, 1, [{ name: 'a.jpg', reason: 'bad' }]);
  jobs.setDone(older);
  const newer = jobs.insert({ userId, galleryId, total: 1 });
  jobs.progress(newer, 1, [{ name: 'b.jpg', reason: 'bad' }]);
  jobs.setDone(newer);
  const failed = jobs.insert({ userId, galleryId, total: 1 });
  jobs.progress(failed, 1, [{ name: 'c.jpg', reason: 'bad' }]);
  jobs.setFailed(failed, 'stopped');
  assert.equal(jobs.pendingNotice(galleryId).id, newer, 'the latest done job; a failed job shows its error instead');
  clock.tick(1000);
  assert.equal(jobs.markNoticeShown(newer), true);
  assert.equal(jobs.byId(newer).notice_shown_at, '2026-10-28T10:00:01.000Z');
  assert.equal(jobs.markNoticeShown(newer), false, 'only the first time counts');
  assert.equal(jobs.pendingNotice(galleryId).id, older);
});
