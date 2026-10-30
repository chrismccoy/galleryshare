import { Router } from 'express';
import { useIdParam } from '../middleware/params.js';
import { notFound } from '../view/respond.js';
import { sendWebp } from '../view/media-stream.js';
import { ROUTES } from '../../config/urls.js';
import { isPublicImageSize } from '../../media/media-store.js';

const MEDIA_CACHE = 'private, max-age=3600';

export function createMediaRouter({ galleriesService, mediaStore, logger }) {
  const router = Router();
  useIdParam(router, 'imageId', 'imageIdParam');

  router.get(ROUTES.media, (req, res) => {
    const imageId = req.imageIdParam;
    const { size } = req.params;
    const found = isPublicImageSize(size) ? galleriesService.imageForViewer(req.user, imageId) : null;
    if (!found) return notFound(res);
    const { gallery, image } = found;

    return sendWebp(res, {
      open: () => mediaStore.stream({ galleryId: gallery.id, imageId: image.id, ext: image.ext }, size),
      cacheControl: MEDIA_CACHE,
      missing: () => notFound(res),
      logger,
      label: 'media stream failed',
      meta: { imageId: image.id },
    });
  });

  return router;
}
