import { Router } from 'express';
import { AREAS } from '../../../domain/activity.js';
import { ADMIN_ROUTES, PATHS } from '../../../config/urls.js';
import { renderActivityPage } from '../../view/activity-page.js';

const ALL_AREAS = Object.values(AREAS);

export function createAdminActivityRouter({ activityService, retentionDays, pageSize }) {
  const router = Router();

  router.get(ADMIN_ROUTES.activity, (req, res) =>
    renderActivityPage(req, res, {
      title: 'Activity',
      path: PATHS.admin.activity,
      admin: true,
      areas: ALL_AREAS,
      retentionDays,
      pageSize: pageSize(),
      ...activityService.filterOptionsForAdmin(),
      list: (filter) => activityService.listForAdmin(filter),
    }),
  );

  return router;
}
