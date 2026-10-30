import { LimitExceededError, ValidationError } from '../lib/errors.js';
import { BYTES_PER_MB } from '../lib/size.js';
import { NOOP_LOGGER } from '../lib/logger.js';
import { removeTempFiles } from '../lib/temp-files.js';
import { ZIP_LIMIT, inspectZip, zipEntryLabel } from '../media/zip-intake.js';
import { IMAGE_TYPES_TEXT, isZipUpload } from '../media/image-types.js';
import { imageCountMessage } from '../domain/limits.js';

export const NO_FILES = 'Choose at least one image or ZIP file.';
export const NO_USABLE_IMAGES = `The upload has no ${IMAGE_TYPES_TEXT} images.`;
const MIN_EXAMINED = 10_000;
const MAX_EXAMINED_FACTOR = 4;
const ZIP_EXPANSION_FACTOR = 2;
export const MAX_NOT_IMAGES = 100;



const sum = (values) => values.reduce((total, value) => total + value, 0);

const pathsOf = (files) => files.filter((file) => file?.path).map((file) => file.path);

function overCount({ existing, have, max }) {
  const adds = existing ? Math.max(0, max - have) : max;
  return new LimitExceededError(imageCountMessage({ existing, have, max, adds, moreThan: true }));
}

function rewordZipError(error, file, room) {
  if (error.code === ZIP_LIMIT.images) return overCount(room);
  if (error.code === ZIP_LIMIT.notImages) {
    return new error.constructor(
      `${file.originalname} has too many files that are not real images (more than ${MAX_NOT_IMAGES} per upload).`,
      { cause: error },
    );
  }
  if (error.code === ZIP_LIMIT.files || !(error instanceof ValidationError)) return error;
  return new error.constructor(`${file.originalname}: ${error.publicMessage}`, { cause: error });
}

export function createUploadIntakeService({
  runInTransaction,
  galleriesService,
  ingestService,
  effectiveConfigService,
  logger = NOOP_LOGGER,
}) {
  async function inspect(uploaded, { existing, have }) {
    if (uploaded.length === 0) throw new ValidationError(NO_FILES);
    const limits = effectiveConfigService.limitValues();
    const room = { existing, have, max: limits.maxImagesPerGallery };
    const zipFiles = uploaded.filter(isZipUpload);
    const loose = uploaded.filter((file) => !isZipUpload(file));
    const files = loose.map((file) => ({ path: file.path, originalName: file.originalname }));
    const zips = [];
    const skipped = [];
    let count = files.length;
    let bytes = sum(loose.map((file) => file.size));
    if (count > room.max - have && zipFiles.length > 0) throw overCount(room);
    for (const file of zipFiles) {
      const { entries, rejected } = await inspectZip(file.path, {
        maxEntryBytes: limits.maxImageMb * BYTES_PER_MB,
        maxTotalBytes: ZIP_EXPANSION_FACTOR * limits.maxZipUploadMb * BYTES_PER_MB,
        maxEntries: room.max - have - count,
        maxExamined: Math.max(MIN_EXAMINED, MAX_EXAMINED_FACTOR * room.max),
        maxRejected: MAX_NOT_IMAGES - skipped.length,
        sniff: true,
        name: file.originalname,
      }).catch((error) => {
        throw rewordZipError(error, file, room);
      });
      zips.push({ path: file.path, originalName: file.originalname, names: entries.map((entry) => entry.name) });
      for (const { name, reason } of rejected) skipped.push({ name: zipEntryLabel(file.originalname, name), reason });
      count += entries.length;
      bytes += sum(entries.map((entry) => entry.size));
    }
    return { count, bytes, source: { files, zips, skipped } };
  }

  function checkAndQueue(uploaderId, galleryId, { count, bytes }, queue) {
    if (count === 0) throw new ValidationError(NO_USABLE_IMAGES);
    galleriesService.checkUpload(uploaderId, galleryId, { count, bytes });
    return runInTransaction(queue);
  }

  async function removeFilesOnFailure(files, step) {
    try {
      return await step();
    } catch (error) {
      await removeTempFiles(pathsOf(files), logger);
      throw error;
    }
  }

  function createGalleryFromUpload(user, files) {
    return removeFilesOnFailure(files, async () => {
      const upload = await inspect(files, { existing: false, have: 0 });
      return checkAndQueue(user.id, null, upload, () => {
        const galleryId = galleriesService.create(user);
        return ingestService.enqueue({ userId: user.id, galleryId, source: upload.source, bytes: upload.bytes });
      });
    });
  }

  function addUploadToGallery(user, galleryId, files) {
    return removeFilesOnFailure(files, async () => {
      const before = galleriesService.getForEdit(user, galleryId);
      const have = galleriesService.imagesHeldOrReserved(before.gallery.id);
      const upload = await inspect(files, { existing: true, have });
      const { gallery } = galleriesService.getForEdit(user, galleryId);
      return checkAndQueue(user.id, gallery.id, upload, () =>
        ingestService.enqueue({ userId: user.id, galleryId: gallery.id, source: upload.source, bytes: upload.bytes }),
      );
    });
  }

  return { inspect, createGalleryFromUpload, addUploadToGallery };
}
