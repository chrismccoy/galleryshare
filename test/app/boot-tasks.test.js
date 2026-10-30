import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { activityRows } from '../helpers/activity.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  housekeepingDeps,
  purgeOlderThan,
  runBootTasks,
  runHousekeeping,
  startHousekeepingTimer,
  startPhashBackfill,
  TMP_MAX_AGE_MS,
} from '../../app/boot-tasks.js';
import { RESTART_MESSAGE } from '../../services/ingest.service.js';
import { processImage } from '../../media/image.js';
import { newTempName } from '../../lib/upload-temp.js';
import { hashToken } from '../../lib/tokens.js';
import { buildContext, mediaContext, insertUser } from '../helpers/context.js';
import { MS_PER_DAY, isoAfter } from '../../lib/time.js';
import { earlier, fakeClock, later, mockIntervals } from '../helpers/clock.js';
import { ENV_ADMIN, openSession } from '../helpers/accounts.js';
import { recordingLogger } from '../helpers/logger.js';
import { tempDir } from '../helpers/temp.js';
import { imageRow } from '../helpers/gallery-seed.js';
import { makeJpeg } from '../helpers/images.js';
import { rowCount } from '../helpers/db.js';

const MINUTE = 60_000;

test('boot tasks sweep expired sessions and keep live ones', async () => {
  const clock = fakeClock();
  const { db, context } = buildContext({ now: clock.now });
  const user = await insertUser(context);
  const expired = openSession(context.sessions, { userId: user.id, expiresAt: earlier(clock.now()) });
  const live = openSession(context.sessions, { userId: user.id, expiresAt: later(clock.now()) });
  await runBootTasks(context, { now: clock.now });
  const tokens = db
    .prepare('SELECT token_hash FROM sessions ORDER BY token_hash')
    .all()
    .map((r) => r.token_hash);
  assert.deepEqual(tokens, [hashToken(live.token)]);
  assert.ok(!tokens.includes(hashToken(expired.token)));
});

test('runBootTasks syncs the env admin when configured', async () => {
  const { context } = buildContext({
    env: { ADMIN_EMAIL: ENV_ADMIN.email, ADMIN_PASSWORD: ENV_ADMIN.password },
  });
  await runBootTasks(context);
  assert.equal(context.users.byEmail(ENV_ADMIN.email).role, 'admin');
});

test('runBootTasks fails unfinished ingest jobs and removes leftover upload temp files only', async (t) => {
  const root = tempDir(t, 'gs-boot-');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(path.join(tmp, 'keep-dir'), { recursive: true });
  const stale = newTempName();
  fs.writeFileSync(path.join(tmp, stale), 'x');
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'unrelated');
  fs.writeFileSync(path.join(tmp, stale.toUpperCase()), 'not our name');
  fs.mkdirSync(path.join(tmp, newTempName()));
  fs.writeFileSync(path.join(tmp, 'keep-dir', newTempName()), 'nested');
  const { context } = buildContext({ env: { TMP_UPLOAD_DIR: tmp } });
  const user = await insertUser(context);
  const galleryId = context.galleriesService.create(user);
  const jobId = context.ingestJobs.insert({ userId: user.id, galleryId, total: 3 });
  await runBootTasks(context);
  assert.equal(context.ingestJobs.byId(jobId).status, 'failed');
  assert.equal(context.ingestJobs.byId(jobId).error, RESTART_MESSAGE);
  const left = fs.readdirSync(tmp);
  assert.ok(!left.includes(stale), 'stale upload removed');
  assert.equal(left.length, 4, 'unrelated file, other names and subdirectories survive');
  assert.ok(left.includes('notes.txt') && left.includes('keep-dir'));
  assert.equal(fs.readdirSync(path.join(tmp, 'keep-dir')).length, 1, 'no recursion into subdirectories');
});

test('runBootTasks deletes image rows a restart left unwritten, with their partial files, and renumbers', async (t) => {
  const { root, context } = mediaContext(t, { prefix: 'gs-boot-' });
  const user = await insertUser(context);
  const galleryId = context.galleriesService.create(user);
  const row = (n, bytes) =>
    context.galleryImages.insert(imageRow(galleryId, { n, bytesOrig: bytes, bytesWeb: bytes, bytesThumb: bytes }));
  const first = row(1, 100);
  const dead = row(2, 0);
  const last = row(3, 100);
  const files = context.mediaStore.paths({ galleryId, imageId: dead, ext: 'jpg' });
  fs.mkdirSync(path.dirname(files.orig), { recursive: true });
  fs.mkdirSync(path.dirname(files.web), { recursive: true });
  fs.writeFileSync(files.orig, 'orig');
  fs.writeFileSync(`${files.web}.part`, 'half');
  await runBootTasks(context);
  assert.equal(context.galleryImages.byId(dead), null);
  assert.deepEqual(
    context.galleryImages.forGallery(galleryId).map((r) => [r.id, r.position]),
    [
      [first, 1],
      [last, 2],
    ],
  );
  assert.ok(!fs.existsSync(files.orig) && !fs.existsSync(`${files.web}.part`), 'partial files removed');
});

async function contextWithUnhashedImages(t, count) {
  const recording = recordingLogger();
  const { root, context } = mediaContext(t, { prefix: 'gs-boot-', logger: recording.logger });
  const galleryId = context.galleriesService.create(await insertUser(context));
  const ids = [];
  for (let i = 0; i < count; i++) {
    const processed = await processImage(await makeJpeg());
    ids.push(await context.galleriesService.addProcessedImage(galleryId, { originalName: `${i}.jpg`, processed }));
  }
  for (const id of ids) context.galleryImages.setPhash(id, null);
  return { context, ids, info: recording.info };
}

test('startPhashBackfill hashes images stored without a hash in the background and logs the count', async (t) => {
  const { context, ids, info } = await contextWithUnhashedImages(t, 2);
  const backfill = startPhashBackfill(context);
  await backfill.idle();
  for (const id of ids) assert.match(context.galleryImages.byId(id).phash, /^[0-9a-f]{16}$/);
  assert.deepEqual(info.at(-1), ['hashed existing images for the duplicate check', { count: 2 }]);
});

test('startPhashBackfill logs nothing when every image already has a hash', async (t) => {
  const { context, info } = await contextWithUnhashedImages(t, 0);
  await startPhashBackfill(context).idle();
  assert.equal(info.filter(([message]) => message.startsWith('hashed')).length, 0);
});

test('stopping startPhashBackfill ends it before the next image', async (t) => {
  const { context, ids } = await contextWithUnhashedImages(t, 3);
  const backfill = startPhashBackfill(context);
  backfill.stop();
  await backfill.idle();
  assert.ok(context.galleryImages.withoutPhash(10).length >= ids.length - 1, 'at most one image was hashed');
});

test('runBootTasks creates a missing temp upload dir', async (t) => {
  const root = tempDir(t, 'gs-boot-');
  const tmp = path.join(root, 'nested', 'tmp');
  const { context } = buildContext({ env: { TMP_UPLOAD_DIR: tmp } });
  await runBootTasks(context);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

const HOUSEKEEPING_AT = '2026-06-01T12:00:00.000Z';

function setup(t, clock) {
  const { root, tmp, context } = mediaContext(t, {
    prefix: 'gs-hk-',
    env: { TRASH_RETENTION_DAYS: '30' },
    now: clock?.now,
  });
  return { root, tmp, context };
}

const daysBefore = (clock, days) => clock.set(isoAfter(new Date(HOUSEKEEPING_AT), -days * MS_PER_DAY));

const housekeep = (context, extra = {}) => runHousekeeping({ ...housekeepingDeps(context), ...extra });

test('housekeepingDeps takes the housekeeping inputs from the context', () => {
  const { context } = buildContext({ env: { TRASH_RETENTION_DAYS: '12' } });
  const now = () => new Date(0);
  assert.deepEqual(housekeepingDeps(context, now), {
    retentionDays: 12,
    activityRetentionDays: 90,
    galleriesService: context.galleriesService,
    sharesService: context.sharesService,
    activityService: context.activityService,
    tmpDir: context.config.tmpDir,
    logger: context.logger,
    now,
  });
});

test('housekeeping purges expired trash with its media and keeps recent trash', async (t) => {
  const clock = fakeClock(HOUSEKEEPING_AT);
  const { context } = setup(t, clock);
  const user = await insertUser(context);
  const old = context.galleriesService.create(user);
  const fresh = context.galleriesService.create(user);
  for (const id of [old, fresh]) {
    fs.mkdirSync(path.join(context.config.mediaDir, String(id)), { recursive: true });
    fs.writeFileSync(path.join(context.config.mediaDir, String(id), 'f'), 'x');
  }
  daysBefore(clock, 31);
  context.galleriesService.trash(user, old);
  daysBefore(clock, 29);
  context.galleriesService.trash(user, fresh);
  clock.set(HOUSEKEEPING_AT);
  await housekeep(context, { now: clock.now });
  assert.equal(context.galleries.byIdIncludingTrashed(old), null);
  assert.ok(!fs.existsSync(path.join(context.config.mediaDir, String(old))));
  assert.ok(context.galleries.byIdIncludingTrashed(fresh));
  assert.ok(fs.existsSync(path.join(context.config.mediaDir, String(fresh))));
});

test('housekeeping removes activity older than ACTIVITY_RETENTION_DAYS and keeps newer', async (t) => {
  const clock = fakeClock(HOUSEKEEPING_AT);
  const { context } = setup(t, clock);
  daysBefore(clock, 91);
  context.activityService.record({ kind: 'serverStarted' });
  daysBefore(clock, 89);
  context.activityService.record({ kind: 'serverStarted' });
  clock.set(HOUSEKEEPING_AT);
  const result = await housekeep(context, { now: clock.now });
  assert.equal(result.counts.activity, 1);
  assert.equal(rowCount(context.db, 'activity', "kind = 'serverStarted'"), 1);
});

test('housekeeping records trash and temp file counts only, and nothing when they are zero', async (t) => {
  const clock = fakeClock(HOUSEKEEPING_AT);
  const { context } = setup(t, clock);
  const housekeepingRows = () => activityRows(context, 'housekeeping');
  await housekeep(context, { now: clock.now });
  assert.deepEqual(housekeepingRows(), [], 'nothing to clean');
  const user = await insertUser(context);
  daysBefore(clock, 91);
  context.activityService.record({ kind: 'serverStarted' });
  daysBefore(clock, 40);
  for (let i = 0; i < 2; i++) context.galleries.trashOwned(context.galleriesService.create(user), user.id);
  clock.set(HOUSEKEEPING_AT);
  const { logger, info } = recordingLogger();
  const { counts } = await housekeep(context, { now: clock.now, logger });
  assert.equal(counts.activity, 1, 'the old activity row was purged');
  const rows = housekeepingRows();
  assert.deepEqual(
    rows.map((row) => row.details),
    ['Trash cleaned up: 2 galleries'],
    'routine purges of old activity and share views are not recorded',
  );
  assert.ok(info.some(([message, fields]) => message === 'purged old activity' && fields.count === 1));
  assert.ok(rows.every((row) => row.actor_type === 'system'));
});

test('ACTIVITY_RETENTION_DAYS is read from the environment', () => {
  const { context } = buildContext({ env: { ACTIVITY_RETENTION_DAYS: '14' } });
  assert.equal(housekeepingDeps(context).activityRetentionDays, 14);
});

test('housekeeping removes upload temp files older than 24 h only', async (t) => {
  const { tmp, context } = setup(t);
  const oldName = newTempName();
  const freshName = newTempName();
  const otherOld = 'notes.txt';
  const dirName = newTempName();
  for (const n of [oldName, freshName, otherOld]) fs.writeFileSync(path.join(tmp, n), 'x');
  fs.mkdirSync(path.join(tmp, dirName));
  const clock = fakeClock();
  const past = new Date(clock.now().getTime() - TMP_MAX_AGE_MS - MINUTE);
  for (const n of [oldName, otherOld, dirName]) fs.utimesSync(path.join(tmp, n), past, past);
  await housekeep(context, { now: clock.now });
  assert.deepEqual(fs.readdirSync(tmp).sort(), [dirName, freshName, otherOld].sort());
});

test('housekeeping returns a failing task in `errors`, counts it as 0 and still runs the others', async (t) => {
  const { tmp, context } = setup(t);
  const oldName = newTempName();
  fs.writeFileSync(path.join(tmp, oldName), 'x');
  const clock = fakeClock();
  const past = new Date(clock.now().getTime() - TMP_MAX_AGE_MS - MINUTE);
  fs.utimesSync(path.join(tmp, oldName), past, past);
  const boom = new Error('boom');
  const result = await housekeep(context, {
    now: clock.now,
    galleriesService: {
      purgeTrashedBefore: () => {
        throw boom;
      },
    },
  });
  assert.deepEqual(result, {
    counts: { trash: 0, shareViews: 0, activity: 0, tmpFiles: 1 },
    errors: [{ message: 'trash purge failed', error: boom }],
  });
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('housekeeping never rejects: every failing task is collected', async () => {
  const { context } = buildContext();
  const broken = () => {
    throw new Error('db broke');
  };
  const result = await housekeep(context, {
    galleriesService: { purgeTrashedBefore: broken },
    sharesService: { purgeViewsBefore: broken },
    tmpDir: '\0not a directory',
  });
  assert.deepEqual(result.counts, { trash: 0, shareViews: 0, activity: 0, tmpFiles: 0 });
  assert.deepEqual(
    result.errors.map((e) => e.message),
    ['trash purge failed', 'share view purge failed', 'temp upload cleanup failed'],
  );
});

test('a throwing purge at boot is logged and boot completes', async (t) => {
  const { logger, error: logs } = recordingLogger();
  const { context } = buildContext({ logger });
  t.mock.method(context.galleriesService, 'purgeTrashedBefore', () => {
    throw new Error('db broke');
  });
  await runBootTasks(context);
  assert.deepEqual(logs, [['trash purge failed', { error: 'db broke' }]]);
});

test('housekeeping purges share views older than 90 days and keeps newer ones', async (t) => {
  const clock = fakeClock(HOUSEKEEPING_AT);
  const { context } = setup(t, clock);
  const user = await insertUser(context);
  const galleryId = context.galleriesService.create(user);
  const shareId = context.shares.insert({ galleryId, token: 'tok-views', nonce: 'nonce-views' });
  for (const [days, ip] of [
    [91, '203.0.113.1'],
    [89, '203.0.113.2'],
    [0, '203.0.113.3'],
  ]) {
    daysBefore(clock, days);
    context.shares.recordView(shareId, { ip });
  }
  const result = await housekeep(context, { now: clock.now });
  assert.equal(result.counts.shareViews, 1);
  assert.deepEqual(result.errors, []);
  const ips = context.shares
    .views(shareId)
    .map((view) => view.ip)
    .sort();
  assert.deepEqual(ips, ['203.0.113.2', '203.0.113.3']);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

function timerWith(t, purge) {
  mockIntervals(t);
  const calls = [];
  const errors = [];
  const context = {
    config: { trash: { retentionDays: 30 }, activity: { retentionDays: 90 } },
    galleriesService: {
      purgeTrashedBefore: () => {
        calls.push(calls.length + 1);
        return purge();
      },
    },
    logger: {
      error: (message, fields) => errors.push([message, fields]),
    },
  };
  const timer = startHousekeepingTimer(context, { intervalMs: 1000 });
  t.after(() => timer.stop());
  return { timer, calls, errors };
}

test('the housekeeping timer runs on every tick, not before the interval', async (t) => {
  const { calls } = timerWith(t, () => 0);
  mock.timers.tick(999);
  await settle();
  assert.equal(calls.length, 0);
  mock.timers.tick(1);
  await settle();
  assert.equal(calls.length, 1);
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 2);
});

test('the housekeeping timer skips a tick while the previous run is still going', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { calls } = timerWith(t, () => gate);
  mock.timers.tick(1000);
  await settle();
  mock.timers.tick(1000);
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 1, 'overlapping ticks are skipped');
  release(0);
  await settle();
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 2, 'the next tick after the run ends goes through');
});

test("the housekeeping timer is unref'd so it cannot keep the process alive", (t) => {
  mockIntervals(t);
  const mockedSetInterval = globalThis.setInterval;
  let unref;
  t.mock.method(globalThis, 'setInterval', (...args) => {
    const handle = mockedSetInterval(...args);
    unref = t.mock.method(handle, 'unref');
    return handle;
  });
  const context = { config: { trash: { retentionDays: 30 }, activity: { retentionDays: 90 } }, galleriesService: {} };
  const timer = startHousekeepingTimer(context, { intervalMs: 1000 });
  timer.stop();
  assert.equal(unref.mock.callCount(), 1);
});

test('stopping the housekeeping timer ends further runs', async (t) => {
  const { timer, calls } = timerWith(t, () => 0);
  mock.timers.tick(1000);
  await settle();
  timer.stop();
  mock.timers.tick(5000);
  await settle();
  assert.equal(calls.length, 1);
});

test('the housekeeping timer reports a failing task through the logger and keeps running', async (t) => {
  const { calls, errors } = timerWith(t, () => {
    throw new Error('db broke');
  });
  mock.timers.tick(1000);
  await settle();
  assert.deepEqual(errors, [['trash purge failed', { error: 'db broke' }]]);
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 2, 'a failed run does not block the next one');
});

test('purgeOlderThan passes the cutoff time, logs a non-zero count, and rejects when the purge throws', async () => {
  const clock = fakeClock('2026-06-10T12:00:00.000Z');
  const { logger, info } = recordingLogger();
  const cutoffs = [];
  const before = (cutoffIso) => {
    cutoffs.push(cutoffIso);
    return 3;
  };
  const purged = purgeOlderThan({ before, retentionDays: 2, done: 'purged things', logger, now: clock.now });
  assert.ok(purged instanceof Promise, 'a synchronous purge still gives a promise');
  assert.equal(await purged, 3);
  assert.deepEqual(cutoffs, ['2026-06-08T12:00:00.000Z']);
  assert.deepEqual(info, [['purged things', { count: 3 }]]);
  const locked = () => {
    throw new Error('locked');
  };
  await assert.rejects(purgeOlderThan({ before: locked, retentionDays: 1, done: 'x', now: clock.now }), /locked/);
});

test('runBootTasks empties the temp folder once: its housekeeping run skips the temp file step', async (t) => {
  const tmp = path.join(tempDir(t, 'gs-boot-once-'), 'tmp');
  const { context } = buildContext({ env: { TMP_UPLOAD_DIR: tmp } });
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(tmp, newTempName()), 'x');
  const readdir = t.mock.method(fs.promises, 'readdir');
  await runBootTasks(context);
  const listings = readdir.mock.calls.filter((call) => call.arguments[0] === tmp);
  assert.equal(listings.length, 1, 'the temp folder is listed once');
  assert.deepEqual(fs.readdirSync(tmp), []);
});
