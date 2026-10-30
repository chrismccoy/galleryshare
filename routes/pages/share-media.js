import { Router } from 'express';
import { NOOP_LOGGER } from '../../lib/logger.js';
import { noStore } from '../view/respond.js';
import { sendWebp } from '../view/media-stream.js';
import { ROUTES } from '../../config/urls.js';
import { imageFileOf, imageSizeOf } from '../view/share-view.js';

const IMAGE_CACHE = 'private, max-age=300';

export function createShareMediaRouter({ sharesService, mediaStore, limits, logger = NOOP_LOGGER }) {
  const router = Router();

  function sendShareImage(req, res, token, publicName, size) {
    res.set('X-Robots-Tag', 'noindex');
    const found = size ? sharesService.resolveImage(token, publicName) : null;
    const missing = () => noStore(res).status(404).type('text/plain').send('Not found.');
    if (!found) return limits.image(req, res, missing);
    const { gallery, image } = found;
    return sendWebp(res, {
      open: () => mediaStore.stream({ galleryId: gallery.id, imageId: image.id, ext: image.ext }, size),
      cacheControl: IMAGE_CACHE,
      missing,
      logger,
      label: 'share media stream failed',
      meta: { imageId: image.id },
    });
  }

  router.get(ROUTES.shareImage, (req, res, next) => {
    const file = imageFileOf(req.params.publicName);
    if (!file) return next();
    return sendShareImage(req, res, req.params.token, file.publicName, file.size);
  });

  router.get(ROUTES.shareImageFile, (req, res) =>
    sendShareImage(req, res, req.params.token, req.params.publicName, imageSizeOf(req.params.file)),
  );

  return router;
}
