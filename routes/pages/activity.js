import { Router } from 'express';
import { AREAS, USER_HIDDEN_AREAS } from '../../domain/activity.js';
import { PATHS } from '../../config/urls.js';
import { renderActivityPage } from '../view/activity-page.js';

const USER_AREAS = Object.values(AREAS).filter((area) => !USER_HIDDEN_AREAS.includes(area));

export function createActivityRouter({ activityService, retentionDays, pageSize }) {
  const router = Router();

  router.get(PATHS.activity, (req, res) =>
    renderActivityPage(req, res, {
      title: 'My activity',
      path: PATHS.activity,
      admin: false,
      areas: USER_AREAS,
      retentionDays,
      pageSize: pageSize(),
      ...activityService.filterOptionsForUser(req.user),
      list: (filter) => activityService.listForUser(req.user, filter),
    }),
  );

  return router;
}
