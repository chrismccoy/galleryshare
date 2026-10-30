import { retryOnCollision } from '../../lib/sqlite-errors.js';
import { ValidationError } from '../../lib/errors.js';
import { dhash, isNearDuplicate } from '../../media/phash.js';
import { errorFields } from '../../lib/logger.js';

const DUPLICATE_IMAGE_MESSAGE = 'Already in this gallery.';

const NAME_ATTEMPTS = 5;

const HASH_BATCH = 100;


export function createGalleryMedia({ galleries, galleryImages, mediaStore, newPublicName, logger }) {
  async function bestEffort(label, meta, fn) {
    try {
      await fn();
    } catch (error) {
      logger.error(label, { ...meta, ...errorFields(error) });
    }
  }

  const removeFiles = (image) =>
    bestEffort('Could not remove image files', { galleryId: image.galleryId, imageId: image.imageId }, () =>
      mediaStore.removeImage(image),
    );

  const removeImageFiles = (row) => removeFiles({ galleryId: row.gallery_id, imageId: row.id, ext: row.ext });

  async function addProcessedImage(galleryId, { originalName, processed }) {
    if (galleryImages.phashes(galleryId).some((phash) => isNearDuplicate(phash, processed.phash))) {
      throw new ValidationError(DUPLICATE_IMAGE_MESSAGE);
    }
    const id = retryOnCollision(NAME_ATTEMPTS, 'gallery_images.public_name', () =>
      galleryImages.insert({
        galleryId,
        publicName: newPublicName(),
        originalName,
        mime: processed.mime,
        ext: processed.ext,
        width: processed.width,
        height: processed.height,
        bytesOrig: 0,
        bytesWeb: 0,
        bytesThumb: 0,
        phash: processed.phash,
      }),
    );
    const image = { galleryId, imageId: id, ext: processed.ext };
    let stored;
    try {
      const bytes = await mediaStore.write(image, processed);
      stored = galleryImages.setBytes(id, bytes);
    } catch (error) {
      galleryImages.remove(id);
      await removeFiles(image);
      throw error;
    }
    if (stored) return id;
    await removeFiles(image);
    if (!galleries.byIdIncludingTrashed(galleryId)) {
      await bestEffort('Could not remove gallery media', { galleryId }, () => mediaStore.removeGallery(galleryId));
    }
    return null;
  }

  async function removeUnwrittenImages() {
    const rows = galleryImages.removeUnwritten();
    for (const row of rows) await removeImageFiles(row);
    if (rows.length) logger.warn('removed images left unwritten by a restart', { count: rows.length });
    return rows.length;
  }

  async function backfillPhashes({ stopped = () => false } = {}) {
    let hashed = 0;
    let afterId = 0;
    for (
      let rows = galleryImages.withoutPhash(HASH_BATCH);
      rows.length;
      rows = galleryImages.withoutPhash(HASH_BATCH, afterId)
    ) {
      for (const row of rows) {
        if (stopped()) return hashed;
        afterId = row.id;
        try {
          const web = await mediaStore.read({ galleryId: row.gallery_id, imageId: row.id, ext: row.ext }, 'web');
          if (galleryImages.setPhash(row.id, await dhash(web))) hashed += 1;
        } catch (error) {
          logger.warn('could not hash image', {
            galleryId: row.gallery_id,
            imageId: row.id,
            ...errorFields(error),
          });
        }
      }
    }
    return hashed;
  }

  async function removeMedia(ids) {
    for (const id of ids) {
      await bestEffort('Could not remove gallery media', { galleryId: id }, () => mediaStore.removeGallery(id));
    }
    return ids.length;
  }

  return { addProcessedImage, removeUnwrittenImages, backfillPhashes, removeImageFiles, removeMedia };
}
