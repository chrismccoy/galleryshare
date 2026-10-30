import { Router } from 'express';
import { ADMIN_ROUTES } from '../../../config/urls.js';
import { galleryTitle } from '../../../domain/gallery.js';
import { formatBytes } from '../../../lib/format.js';
import { renderInShell } from '../../view/respond.js';
import { RECENT_ACTIVITY, toActivityRow } from '../../view/activity-page.js';
import { toKpiTiles } from '../../view/kpi-tiles.js';

export function toLargestRows(largest) {
  return largest.map((row) => ({
    id: row.id,
    title: galleryTitle(row),
    owner: row.owner_name,
    imageCount: row.image_count,
    size: formatBytes(row.bytes),
  }));
}

export function createAdminOverviewRouter({ usersService, statsService, activityService }) {
  const router = Router();

  router.get(ADMIN_ROUTES.overview, (_req, res) => {
    const overview = statsService.overview();
    return renderInShell(res, 'pages/admin/overview', {
      title: 'Overview',
      tiles: toKpiTiles({ userStats: usersService.stats(), overview }),
      largest: toLargestRows(overview.largest),
      activity: activityService.listForAdmin({ limit: RECENT_ACTIVITY }).map(toActivityRow),
    });
  });

  return router;
}
