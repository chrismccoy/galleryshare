import { Router } from 'express';
import { ConflictError, NotFoundError, SharingOffError } from '../../lib/errors.js';
import { noticeFor } from '../../lib/params.js';
import { jsonError, notFound, seeOther, withFormErrors, withNotice } from '../view/respond.js';
import { useIdParam } from '../middleware/params.js';
import { imageFieldsFrom, parseOrderIds } from '../view/gallery-form.js';
import { PATHS, PATH_TO, ROUTES } from '../../config/urls.js';

const BAD_ORDER = 'Send the image ids as a list of numbers.';

const NOTICES = {
  saved: 'Gallery saved.',
  added:
    'Images added and saved. Edit titles, captions and order below; Save gallery appears once you change something.',
  removed: 'Image removed.',
  shared: 'Share link created.',
  unshared: 'Share link revoked.',
};

export function createGalleriesRouter({ galleriesService, sharesService, renderEdit }) {
  const router = Router();
  useIdParam(router);
  useIdParam(router, 'imageId', 'imageIdParam');

  const galleryPath = (id, notice) => (notice ? withNotice(PATH_TO.gallery(id), notice) : PATH_TO.gallery(id));

  router.get(ROUTES.gallery, (req, res) =>
    renderEdit(req, res, { notice: noticeFor(NOTICES, req.query.notice), takeNotice: req.method === 'GET' }),
  );

  function editAction(handler, typedFrom) {
    return (req, res) =>
      withFormErrors(
        res,
        () => handler(req, res),
        (message, _error, status) => renderEdit(req, res, { status, error: message, typed: typedFrom?.(req) }),
        { also: [{ type: SharingOffError, status: 403 }] },
      );
  }

  const metaFrom = (body) => ({
    title: body.title,
    description: body.description,
    allowZip: body.allow_zip === 'on',
    ...(body.grid_text !== undefined && { gridText: body.grid_text }),
    ...(body.share_theme !== undefined && { shareTheme: body.share_theme }),
    ...(body.share_image_view !== undefined && { imageView: body.share_image_view }),
  });

  router.post(
    ROUTES.galleryMeta,
    editAction(
      async (req, res) => {
        const body = req.body ?? {};
        const images = [...imageFieldsFrom(body)].map(([imageId, { remove, ...fields }]) => ({
          imageId,
          ...fields,
          remove: remove !== undefined,
        }));
        await galleriesService.saveEdits(req.user, req.idParam, { meta: metaFrom(body), images });
        return seeOther(res, galleryPath(req.idParam, 'saved'));
      },
      (req) => ({ meta: metaFrom(req.body ?? {}), images: imageFieldsFrom(req.body ?? {}) }),
    ),
  );

  router.post(
    ROUTES.galleryImageRemove,
    editAction(async (req, res) => {
      await galleriesService.removeImage(req.user, req.idParam, req.imageIdParam);
      return seeOther(res, galleryPath(req.idParam, 'removed'));
    }),
  );

  router.post(
    ROUTES.galleryShare,
    editAction((req, res) => {
      sharesService.share(req.user, req.idParam);
      return seeOther(res, galleryPath(req.idParam, 'shared'));
    }),
  );

  router.post(
    ROUTES.galleryUnshare,
    editAction((req, res) => {
      const { gallery } = galleriesService.getForEdit(req.user, req.idParam);
      sharesService.revokeFor(req.user, gallery.id);
      return seeOther(res, galleryPath(gallery.id, 'unshared'));
    }),
  );

  router.post(
    ROUTES.galleryDelete,
    editAction((req, res) => {
      const { gallery } = galleriesService.getForEdit(req.user, req.idParam);
      galleriesService.trash(req.user, gallery.id);
      const list = gallery.user_id === req.user.id ? PATHS.galleries : PATHS.admin.galleries;
      return seeOther(res, withNotice(list, 'trashed'));
    }),
  );

  router.post(ROUTES.galleryReorder, (req, res) => {
    const ids = parseOrderIds(req.body);
    if (!ids) return jsonError(res, 400, BAD_ORDER);
    try {
      galleriesService.reorder(req.user, req.idParam, ids);
    } catch (error) {
      if (error instanceof NotFoundError) return notFound(res, { api: true });
      if (error instanceof ConflictError) return jsonError(res, 409, error.publicMessage);
      throw error;
    }
    return res.status(204).end();
  });

  return router;
}
