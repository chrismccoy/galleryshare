import { LimitExceededError } from '../../lib/errors.js';
import { BYTES_PER_MB, toMb } from '../../lib/size.js';
import { imageCountMessage } from '../../domain/limits.js';


export function createUploadQuota({ galleries, galleryImages, ingestJobs, effectiveConfigService }) {
  const imagesHeldOrReserved = (galleryId) => galleryImages.count(galleryId) + ingestJobs.pendingImages(galleryId);

  function checkUpload(uploaderId, galleryId, { count, bytes }) {
    const limits = effectiveConfigService.limitValues();
    const existing = galleryId == null ? null : galleries.liveById(galleryId);
    const ownerOf = existing ? existing.user_id : uploaderId;
    const have = existing ? imagesHeldOrReserved(existing.id) : 0;
    const max = limits.maxImagesPerGallery;
    if (have + count > max) {
      throw new LimitExceededError(imageCountMessage({ existing: Boolean(existing), have, max, adds: count }));
    }
    const quota = limits.userQuotaMb;
    if (quota > 0) {
      const used = galleries.bytesForUser(ownerOf) + ingestJobs.pendingBytesForUser(ownerOf);
      if (used + bytes > quota * BYTES_PER_MB) {
        const whose = ownerOf === uploaderId ? 'your' : "the gallery owner's";
        throw new LimitExceededError(`This upload would use ${toMb(used + bytes)} MB of ${whose} ${quota} MB storage.`);
      }
    }
  }

  return { imagesHeldOrReserved, checkUpload };
}
