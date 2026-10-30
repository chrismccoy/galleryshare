import { Router } from 'express';
import { LimitExceededError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { removeUploadFiles, uploadFiles, uploadedFiles } from '../middleware/upload.js';
import { notFound, renderInShell, seeOther } from '../view/respond.js';
import { useIdParam } from '../middleware/params.js';
import { uploadHelp } from '../view/gallery-edit.js';
import { PATHS, PATH_TO, ROUTES } from '../../config/urls.js';

const uploadStatus = (error) => (error instanceof LimitExceededError ? 413 : 422);

function uploadFailed(rerender) {
  return (error, req, res, next) => {
    removeUploadFiles(req);
    if (error instanceof NotFoundError) return notFound(res);
    if (!(error instanceof ValidationError)) return next(error);
    try {
      return rerender(req, res, { status: uploadStatus(error), error: error.publicMessage });
    } catch (renderError) {
      if (renderError instanceof NotFoundError) return notFound(res);
      return next(renderError);
    }
  };
}

export function createGalleryUploadRouter({ uploadIntake, effectiveConfigService, renderEdit, tmpDir }) {
  const router = Router();
  useIdParam(router);

  function renderNew(req, res, { status = 200, error = null } = {}) {
    return renderInShell(res.status(status), 'pages/gallery-new', {
      title: 'Add gallery',
      hero: { icon: 'add-gallery', lead: 'Upload images or ZIP files to start a new gallery.' },
      upload: uploadHelp(effectiveConfigService.limitValues()),
      uploadAction: PATHS.newGalleryUpload,
      error,
      scripts: ['gallery-upload-rules', 'gallery-upload'],
    });
  }

  router.get(PATHS.newGallery, (req, res) => renderNew(req, res));

  router.post(
    PATHS.newGalleryUpload,
    ...uploadFiles(effectiveConfigService, tmpDir),
    async (req, res) => {
      const jobId = await uploadIntake.createGalleryFromUpload(req.user, uploadedFiles(req));
      return seeOther(res, PATH_TO.ingestJob(jobId));
    },
    uploadFailed(renderNew),
  );

  router.post(
    ROUTES.galleryUpload,
    ...uploadFiles(effectiveConfigService, tmpDir),
    async (req, res) => {
      const jobId = await uploadIntake.addUploadToGallery(req.user, req.idParam, uploadedFiles(req));
      return seeOther(res, PATH_TO.ingestJob(jobId));
    },
    uploadFailed(renderEdit),
  );

  return router;
}
