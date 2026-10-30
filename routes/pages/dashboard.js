import { Router } from 'express';
import { renderInShell, seeOther } from '../view/respond.js';
import { toUserKpiTiles } from '../view/kpi-tiles.js';
import { toGalleryRow } from '../view/gallery-rows.js';
import { RECENT_ACTIVITY, toActivityRow } from '../view/activity-page.js';
import { PATHS } from '../../config/urls.js';

const RECENT = 6;

export function createDashboardRouter({ galleriesService, sharesService, activityService }) {
  const router = Router();

  router.get(PATHS.front, (_req, res) => seeOther(res, PATHS.dashboard));

  router.get(PATHS.dashboard, (req, res) => {
    const { galleries: galleryCount, images, bytes } = galleriesService.dashboardTotals(req.user.id);
    const sharedIds = sharesService.liveGalleryIds(req.user.id);
    return renderInShell(res, 'pages/dashboard', {
      title: 'Dashboard',
      tiles: toUserKpiTiles({
        galleries: galleryCount,
        images,
        bytes,
        liveLinks: sharesService.countLiveForUser(req.user.id),
      }),
      recent: galleriesService
        .listForUser(req.user.id, { limit: RECENT })
        .map((row) => toGalleryRow(row, { sharedIds })),
      activity: activityService.listForUser(req.user, { limit: RECENT_ACTIVITY }).map(toActivityRow),
    });
  });

  return router;
}
