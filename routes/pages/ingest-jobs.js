import { Router } from 'express';
import { INGEST_STATUS, skippedCounts } from '../../domain/ingest.js';
import { noStore, notFound, renderInShell, seeOther, withNotice } from '../view/respond.js';
import { useIdParam } from '../middleware/params.js';
import { PATH_TO, ROUTES } from '../../config/urls.js';

const REFRESH_SECONDS = 3;

export function createIngestJobsRouter({ ingestService, galleriesService }) {
  const router = Router();
  useIdParam(router);

  router.get(ROUTES.ingestJob, (req, res) => {
    const job = ingestService.jobForViewer(req.user, req.idParam);
    if (!job) return notFound(res);
    const counts = skippedCounts(job.skipped);
    const addedSome = job.processed > counts.total - counts.atUpload;
    if (job.status === INGEST_STATUS.done) {
      const gallery = PATH_TO.gallery(job.gallery_id);
      return seeOther(res, addedSome ? withNotice(gallery, 'added') : gallery);
    }
    const waiting = job.status === INGEST_STATUS.pending || job.status === INGEST_STATUS.running;
    noStore(res);
    return renderInShell(res, 'pages/gallery-job', {
      title: 'Adding images',
      job,
      waiting,
      skippedTotal: counts.total,
      addedSome,
      refreshSeconds: waiting ? REFRESH_SECONDS : null,
      galleryOpen: Boolean(galleriesService.findLive(job.gallery_id)),
    });
  });

  return router;
}
