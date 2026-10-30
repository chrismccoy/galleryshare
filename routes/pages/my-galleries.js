import { Router } from 'express';
import { noticeFor } from '../../lib/params.js';
import { renderInShell } from '../view/respond.js';
import { listPage } from '../view/list-page.js';
import { TRASHED_NOTICE, toGalleryRow } from '../view/gallery-rows.js';
import { PATHS } from '../../config/urls.js';

const NOTICE_LINKS = { trashed: { href: PATHS.trash, label: 'Open Trash' } };

export function createMyGalleriesRouter({ galleriesService, sharesService, pageSize }) {
  const router = Router();

  router.get(PATHS.galleries, (req, res) => {
    const { rows, olderUrl } = listPage(req, {
      pageSize: pageSize(),
      path: PATHS.galleries,
      fetch: ({ beforeId, limit }) => galleriesService.listForUser(req.user.id, { beforeId, limit }),
    });
    const sharedIds = sharesService.liveGalleryIds(req.user.id);
    return renderInShell(res, 'pages/galleries', {
      title: 'My galleries',
      rows: rows.map((row) => toGalleryRow(row, { sharedIds })),
      olderUrl,
      notice: noticeFor(TRASHED_NOTICE, req.query.notice),
      noticeLink: noticeFor(NOTICE_LINKS, req.query.notice),
    });
  });

  return router;
}
