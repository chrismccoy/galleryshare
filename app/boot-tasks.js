import fs from 'node:fs/promises';
import path from 'node:path';
import { VIEW_RETENTION_DAYS } from '../domain/share-links.js';
import { MS_PER_DAY, MS_PER_HOUR, isoAfter, systemNow } from '../lib/time.js';
import { isTempName } from '../lib/upload-temp.js';
import { NOOP_LOGGER, errorFields } from '../lib/logger.js';
import { syncEnvAdmin } from './env-admin-sync.js';

export const HOUSEKEEPING_INTERVAL_MS = MS_PER_HOUR;

export const TMP_MAX_AGE_MS = MS_PER_DAY;

async function removeUploadTempFiles(dir, { maxAgeMs, now = systemNow } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const cutoff = maxAgeMs == null ? null : now().getTime() - maxAgeMs;
  let removed = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !isTempName(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (cutoff != null) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.mtimeMs > cutoff) continue;
    }
    await fs.rm(file, { force: true });
    removed += 1;
  }
  return removed;
}

export async function purgeOlderThan({ before, retentionDays, done, logger = NOOP_LOGGER, now = systemNow }) {
  const count = await before(isoAfter(now(), -retentionDays * MS_PER_DAY));
  if (count) logger.info(done, { count });
  return count;
}




export function housekeepingDeps(context, now = systemNow) {
  const { config, galleriesService, sharesService, activityService, logger } = context;
  return {
    retentionDays: config.trash.retentionDays,
    activityRetentionDays: config.activity.retentionDays,
    galleriesService,
    sharesService,
    activityService,
    tmpDir: config.tmpDir,
    logger,
    now,
  };
}

const HOUSEKEEPING_TEXTS = [
  ['trash', 'Trash cleaned up', 'gallery', 'galleries'],
  ['tmpFiles', 'Temp upload files removed', 'file', 'files'],
];

function recordHousekeeping(activityService, counts) {
  if (!activityService) return;
  for (const [key, text, one, many] of HOUSEKEEPING_TEXTS) {
    const count = counts[key];
    if (count > 0) {
      activityService.record({
        kind: 'housekeeping',
        actor: 'system',
        details: `${text}: ${count} ${count === 1 ? one : many}`,
      });
    }
  }
}

export async function runHousekeeping({
  retentionDays,
  activityRetentionDays,
  galleriesService,
  sharesService,
  activityService,
  tmpDir,
  logger = NOOP_LOGGER,
  now = systemNow,
}) {
  const errors = [];
  const attempt = async (failure, task) => {
    try {
      return await task();
    } catch (error) {
      errors.push({ message: failure, error });
      return 0;
    }
  };
  const purges = [
    {
      key: 'trash',
      failure: 'trash purge failed',
      before: galleriesService.purgeTrashedBefore,
      retentionDays,
      done: 'purged expired galleries from trash',
    },
    sharesService && {
      key: 'shareViews',
      failure: 'share view purge failed',
      before: sharesService.purgeViewsBefore,
      retentionDays: VIEW_RETENTION_DAYS,
      done: 'purged old share views',
    },
    activityService && {
      key: 'activity',
      failure: 'activity purge failed',
      before: activityService.purgeBefore,
      retentionDays: activityRetentionDays,
      done: 'purged old activity',
    },
  ].filter(Boolean);
  const counts = { trash: 0, shareViews: 0, activity: 0, tmpFiles: 0 };
  for (const { key, failure, ...purge } of purges) {
    counts[key] = await attempt(failure, () => purgeOlderThan({ ...purge, logger, now }));
  }
  if (tmpDir) {
    counts.tmpFiles = await attempt('temp upload cleanup failed', () =>
      removeUploadTempFiles(tmpDir, { maxAgeMs: TMP_MAX_AGE_MS, now }),
    );
  }
  recordHousekeeping(activityService, counts);
  return { counts, errors };
}

function logHousekeepingErrors(errors, logger = NOOP_LOGGER) {
  for (const { message, error } of errors) logger.error(message, errorFields(error));
}

export function startHousekeepingTimer(context, { intervalMs = HOUSEKEEPING_INTERVAL_MS, now } = {}) {
  const deps = housekeepingDeps(context, now);
  let running = null;
  const handle = setInterval(async () => {
    if (running) return;
    running = runHousekeeping(deps).then(({ errors }) => logHousekeepingErrors(errors, context.logger));
    try {
      await running;
    } finally {
      running = null;
    }
  }, intervalMs);
  handle.unref();
  return {
    handle,
    stop: () => clearInterval(handle),
    idle: async () => {
      await running;
    },
  };
}

export function startPhashBackfill({ galleriesService, logger = NOOP_LOGGER }) {
  let stopped = false;
  const running = galleriesService
    .backfillPhashes({
      stopped: () => stopped,
    })
    .then((count) => {
      if (count) logger.info('hashed existing images for the duplicate check', { count });
    })
    .catch((error) => logger.error('hashing existing images failed', errorFields(error)));
  return {
    stop: () => {
      stopped = true;
    },
    idle: () => running,
  };
}

export async function runBootTasks(context, { now = systemNow } = {}) {
  const {
    config,
    sessions,
    users,
    resetTokens,
    authService,
    runInTransaction,
    ingestService,
    galleriesService,
    logger,
  } = context;
  ingestService.recover();
  await galleriesService.removeUnwrittenImages();
  await removeUploadTempFiles(config.tmpDir);
  sessions.sweep();
  const { errors } = await runHousekeeping({ ...housekeepingDeps(context, now), tmpDir: undefined });
  logHousekeepingErrors(errors, logger);
  await syncEnvAdmin({ config, users, resetTokens, authService, runInTransaction, logger });
}
