import { Router } from 'express';
import { purgeDate } from '../../lib/format.js';
import { noticeFor } from '../../lib/params.js';
import { orNotFound, renderInShell, seeOther, withNotice } from '../view/respond.js';
import { useIdParam } from '../middleware/params.js';
import { listPage } from '../view/list-page.js';
import { toGalleryRow } from '../view/gallery-rows.js';
import { PATHS, ROUTES } from '../../config/urls.js';

const NOTICES = {
  restored: 'Gallery restored.',
  purged: 'Gallery deleted forever.',
  emptied: 'Trash emptied.',
};

export function createTrashRouter({ retentionDays, galleriesService, pageSize }) {
  const router = Router();
  useIdParam(router);

  router.get(PATHS.trash, (req, res) => {
    const { rows, olderUrl } = listPage(req, {
      pageSize: pageSize(),
      path: PATHS.trash,
      fetch: ({ beforeId, limit }) => galleriesService.listTrash(req.user.id, { beforeId, limit }),
    });
    return renderInShell(
      res,
      'pages/trash',
      {
        title: 'Trash',
        rows: rows.map((row) => ({ ...toGalleryRow(row), purgeOn: purgeDate(row.deleted_at, retentionDays) })),
        retentionDays,
        olderUrl,
        notice: noticeFor(NOTICES, req.query.notice),
      },
      { actions: 'partials/head-actions/trash' },
    );
  });

  router.post(PATHS.trashEmpty, async (req, res) => {
    await galleriesService.emptyTrash(req.user);
    return seeOther(res, withNotice(PATHS.trash, 'emptied'));
  });

  router.post(ROUTES.trashRestore, (req, res) =>
    orNotFound(res, () => {
      galleriesService.restore(req.user, req.idParam);
      return seeOther(res, withNotice(PATHS.trash, 'restored'));
    }),
  );

  router.post(ROUTES.trashPurge, (req, res) =>
    orNotFound(res, async () => {
      await galleriesService.purge(req.user, req.idParam);
      return seeOther(res, withNotice(PATHS.trash, 'purged'));
    }),
  );

  return router;
}
