import { Router } from 'express';
import { streamGalleryZip } from '../../media/zip-out.js';
import { VIEW_KINDS } from '../../domain/share-links.js';
import { zipEntryName, zipOffered } from '../../domain/gallery.js';
import { NOOP_LOGGER } from '../../lib/logger.js';
import { ROUTES } from '../../config/urls.js';
import { shareHeaders, unavailable, visitOf } from '../view/share-responses.js';

function zipDownload({ sharesService, mediaStore, now, logger }) {
  return async (req, res) => {
    const { token } = req.params;
    const found = sharesService.resolve(token);
    if (!found || !zipOffered(found.gallery, found.images.length)) return unavailable(res);
    const { share, gallery, images } = found;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="gallery-${token}.zip"`,
    });
    if (req.method === 'HEAD') return res.end();
    try {
      await streamGalleryZip(res, {
        images,
        mediaStore,
        galleryId: gallery.id,
        entryName: zipEntryName,
        now,
        logger,
        onStart: () => sharesService.recordView(share.id, visitOf(req, gallery, VIEW_KINDS.zip)),
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') logger.warn('zip download failed', { galleryId: gallery.id, error: error?.code });
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Type');
      return unavailable(res);
    }
    return undefined;
  };
}

export function createShareZipRouter({ sharesService, mediaStore, limits, now, logger = NOOP_LOGGER }) {
  const router = Router();
  router.get(ROUTES.shareZip, shareHeaders, limits.zip, zipDownload({ sharesService, mediaStore, now, logger }));
  return router;
}
