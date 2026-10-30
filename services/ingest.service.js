import fs from 'node:fs/promises';
import { removeTempFile } from '../lib/temp-files.js';
import { AppError, NotFoundError, ValidationError, isServerError, toPublicError } from '../lib/errors.js';
import { processImage } from '../media/image.js';
import { entryBasename, zipEntryLabel, zipImages } from '../media/zip-intake.js';
import { INGEST_STATUS, MAX_SKIPPED_LISTED } from '../domain/ingest.js';
import { NOOP_LOGGER, errorFields } from '../lib/logger.js';
import { createWorkQueue } from '../lib/work-queue.js';
import { delegateMethods } from '../lib/delegate.js';
import { NOOP_ACTIVITY } from './activity.service.js';
import { galleryEventFields } from '../domain/gallery-activity.js';
import { plural } from '../lib/plural.js';

export const RESTART_MESSAGE = 'Interrupted by restart. Upload the remaining images again.';
const CANCELLED_MESSAGE = 'Cancelled because the account is no longer active.';
const GALLERY_GONE_MESSAGE = 'The gallery was deleted before all images were added.';
const NO_IMAGES_MESSAGE = 'Choose at least one image.';

const NAME_ORDER_LOCALE = 'en';
const naturalOrder = new Intl.Collator(NAME_ORDER_LOCALE, { numeric: true, sensitivity: 'base' }).compare;


function sourcePaths(source) {
  return [...source.files.map((file) => file.path), ...source.zips.map((zip) => zip.path)];
}

function sourceTotal(source) {
  return source.files.length + source.zips.reduce((total, zip) => total + zip.names.length, 0);
}

function storedSkipped({ skipped, more }) {
  return more
    ? [...skipped, { name: '…', reason: `and ${plural(more, 'more file was', 'more files were')} skipped`, more }]
    : skipped;
}

export function createIngestService({
  runInTransaction,
  ingestJobs,
  galleriesService,
  users,
  logger = NOOP_LOGGER,
  activityService = NOOP_ACTIVITY,
  concurrency = 1,
}) {
  const cleanups = new Set();

  const removeFile = (path) => removeTempFile(path, logger);
  const removeSource = (source) => Promise.all(sourcePaths(source).map(removeFile));

  function removeSourceLater(source) {
    const removal = removeSource(source).finally(() => cleanups.delete(removal));
    cleanups.add(removal);
  }

  async function* fileItems(files) {
    for (const file of [...files].sort((a, b) => naturalOrder(a.originalName, b.originalName))) {
      try {
        yield {
          name: file.originalName,
          label: file.originalName,
          read: () => fs.readFile(file.path),
        };
      } finally {
        await removeFile(file.path);
      }
    }
  }

  async function* zipItems(zip) {
    const names = [...zip.names].sort(naturalOrder);
    for await (const { name, buffer, error } of zipImages(zip.path, new Set(names))) {
      yield {
        name: entryBasename(name),
        label: zipEntryLabel(zip.originalName, name),
        read: async () => {
          if (error) throw error;
          return buffer;
        },
      };
    }
  }

  async function* sourceItems(source) {
    yield* fileItems(source.files);
    for (const zip of [...source.zips].sort((a, b) => naturalOrder(a.originalName, b.originalName))) {
      yield* zipItems(zip);
    }
  }

  async function addOne(job, item) {
    const processed = await processImage(await item.read());
    return (await galleriesService.addProcessedImage(job.gallery_id, { originalName: item.name, processed })) !== null;
  }

  async function ingestSource(job, source, progress) {
    for await (const item of sourceItems(source)) {
      if (!galleriesService.findLive(job.gallery_id)) {
        throw new AppError('gallery gone', { publicMessage: GALLERY_GONE_MESSAGE });
      }
      try {
        if (await addOne(job, item)) progress.added += 1;
      } catch (error) {
        const { status, message } = toPublicError(error);
        if (isServerError(status)) logger.error('ingest item failed', { jobId: job.id, ...errorFields(error) });
        if (progress.skipped.length < MAX_SKIPPED_LISTED) progress.skipped.push({ name: item.label, reason: message });
        else progress.more += 1;
      }
      progress.processed += 1;
      ingestJobs.progress(job.id, progress.processed, storedSkipped(progress));
    }
  }

  function recordImagesAdded(job, progress) {
    const skipped = progress.skipped.length + progress.more;
    const { added } = progress;
    const details = [added && `${added} added`, skipped && `${skipped} skipped`].filter(Boolean).join(', ');
    if (!details) return;
    const gallery = galleriesService.findLive(job.gallery_id) ?? {
      id: job.gallery_id,
      user_id: job.user_id,
      title: null,
    };
    activityService.record({ kind: 'imagesAdded', ...galleryEventFields(job.user_id, gallery), details });
  }

  async function runJob(job, source) {
    const atUpload = (source.skipped ?? []).map((item) => ({ ...item, atUpload: true }));
    const progress = { processed: 0, added: 0, skipped: atUpload.slice(0, MAX_SKIPPED_LISTED), more: 0 };
    progress.more = atUpload.length - progress.skipped.length;
    let done = false;
    try {
      if (progress.skipped.length) ingestJobs.progress(job.id, 0, storedSkipped(progress));
      await ingestSource(job, source, progress);
      done = ingestJobs.setDone(job.id);
    } catch (error) {
      logger.error('ingest job failed', { jobId: job.id, ...errorFields(error) });
      ingestJobs.setFailed(job.id, toPublicError(error).message);
    }
    if (done || progress.processed > 0) galleriesService.markEdited(job.gallery_id, job.user_id);
    recordImagesAdded(job, progress);
  }

  async function runQueuedJob(jobId, source) {
    try {
      const job = ingestJobs.byId(jobId);
      if (!job || job.status !== INGEST_STATUS.pending) return;
      const user = users.byId(job.user_id);
      if (!user || user.disabled) {
        ingestJobs.setFailed(jobId, CANCELLED_MESSAGE);
        return;
      }
      if (!ingestJobs.setRunning(jobId)) return;
      await runJob(job, source);
    } catch (error) {
      logger.error('ingest worker error', { jobId, ...errorFields(error) });
    } finally {
      await removeSource(source);
    }
  }

  const queue = createWorkQueue({ concurrency, run: runQueuedJob });

  function enqueue({ userId, galleryId, source, bytes = 0 }) {
    let jobId;
    try {
      if (!galleriesService.findLive(galleryId)) throw new NotFoundError('Gallery not found');
      const total = sourceTotal(source);
      if (total === 0) throw new ValidationError(NO_IMAGES_MESSAGE);
      jobId = ingestJobs.insert({ userId, galleryId, total, bytes });
    } catch (error) {
      removeSourceLater(source);
      throw error;
    }
    queue.add(jobId, source);
    return jobId;
  }

  function recover() {
    const rows = ingestJobs.unfinished();
    runInTransaction(() => {
      for (const row of rows) ingestJobs.setFailed(row.id, RESTART_MESSAGE);
    });
    if (rows.length) logger.warn('failed ingest jobs interrupted by restart', { count: rows.length });
    return rows.length;
  }

  function takeFinishedNotice(galleryId) {
    if (ingestJobs.activeForGallery(galleryId)) return null;
    const finished = ingestJobs.pendingNotice(galleryId);
    if (finished) ingestJobs.markNoticeShown(finished.id);
    return finished;
  }

  function jobForViewer(user, jobId) {
    const job = ingestJobs.byId(jobId);
    if (!job) return null;
    const mine = job.user_id === user.id;
    return mine || galleriesService.canManage(user, job.gallery_id, { includeTrashed: true }) ? job : null;
  }

  return {
    enqueue,
    recover,
    takeFinishedNotice,
    jobForViewer,
    ...delegateMethods(ingestJobs, ['activeForGallery']),
    async idle() {
      await queue.idle();
      await Promise.all(cleanups);
    },
    size: () => queue.size(),
  };
}
