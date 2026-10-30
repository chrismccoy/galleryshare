import { Router } from 'express';
import { ADMIN_ROUTES, PATHS } from '../../../config/urls.js';
import { noticeFor, positiveInt } from '../../../lib/params.js';
import { renderInShell } from '../../view/respond.js';
import { listPage } from '../../view/list-page.js';
import { TRASHED_NOTICE, toGalleryRow } from '../../view/gallery-rows.js';

export function createAdminGalleriesRouter({ galleriesService, sharesService, pageSize }) {
  const router = Router();

  router.get(ADMIN_ROUTES.galleries, (req, res) => {
    const userId = positiveInt(req.query.user);
    const { rows, olderUrl } = listPage(req, {
      pageSize: pageSize(),
      path: PATHS.admin.galleries,
      params: { user: userId },
      fetch: ({ beforeId, limit }) => galleriesService.listAll({ userId: userId ?? undefined, beforeId, limit }),
    });
    const sharedIds = sharesService.liveAmong(rows.map((row) => row.id));
    return renderInShell(res, 'pages/admin/galleries', {
      title: 'Galleries',
      rows: rows.map((row) => ({ ...toGalleryRow(row, { sharedIds }), owner: row.owner_name })),
      userId,
      olderUrl,
      notice: noticeFor(TRASHED_NOTICE, req.query.notice),
    });
  });

  return router;
}
