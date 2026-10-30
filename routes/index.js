import { Router } from 'express';
import { requireAdmin } from './middleware/guards.js';
import { createLinks } from './view/links.js';
import { ADMIN_PREFIX } from '../config/urls.js';
import { createAuthRouter } from './pages/auth.js';
import { createInviteRouter } from './pages/invite.js';
import { createResetRouter } from './pages/reset.js';
import { createAccountRouter } from './pages/account.js';
import { createDashboardRouter } from './pages/dashboard.js';
import { createGalleriesRouter } from './pages/galleries.js';
import { createGalleryEditView } from './view/gallery-edit.js';
import { createGalleryUploadRouter } from './pages/gallery-upload.js';
import { createIngestJobsRouter } from './pages/ingest-jobs.js';
import { createMyGalleriesRouter } from './pages/my-galleries.js';
import { createTrashRouter } from './pages/trash.js';
import { createMediaRouter } from './pages/media.js';
import { createShareRouter } from './pages/share.js';
import { createShareMediaRouter } from './pages/share-media.js';
import { createShareZipRouter } from './pages/share-zip.js';
import { createShareLimits } from './middleware/share-limits.js';
import { createAdminOverviewRouter } from './pages/admin/overview.js';
import { createAdminGalleriesRouter } from './pages/admin/galleries.js';
import { createActivityRouter } from './pages/activity.js';
import { createAdminActivityRouter } from './pages/admin/activity.js';
import { createAdminSharesRouter } from './pages/admin/shares.js';
import { createAdminUsersRouter } from './pages/admin/users.js';
import { createAdminSettingsRouter } from './pages/admin/settings.js';
import { createAdminInvitesRouter } from './pages/admin/invites.js';

function pageSizeReader(effectiveConfigService) {
  return () => effectiveConfigService.pageSize().value;
}

function sharingReader(settingsService) {
  return () => settingsService.publicSharingOn();
}

export function mountPublicRoutes(app, context) {
  const { authService, config, invitesService, resetService, publicFormLimiter, activityService } = context;
  const { sharesService, mediaStore, shareLimiter, zipLimiter, effectiveConfigService, now, logger } = context;
  const { session } = config;
  app.use(createAuthRouter({ authService, session, publicFormLimiter, activityService }));
  app.use(createInviteRouter({ authService, session, invitesService, publicFormLimiter, activityService }));
  app.use(createResetRouter({ resetService, publicFormLimiter, activityService }));
  const limits = createShareLimits({ shareLimiter, zipLimiter, activityService });
  app.use(createShareMediaRouter({ sharesService, mediaStore, limits, logger }));
  app.use(createShareRouter({ sharesService, limits, effectiveConfigService }));
  app.use(createShareZipRouter({ sharesService, mediaStore, limits, now, logger }));
}

export function mountUserRoutes(app, context) {
  const { config, authService, usersService, galleriesService, mediaStore, logger } = context;
  const { ingestService, effectiveConfigService, sharesService, settingsService, uploadIntake, activityService } =
    context;
  const { session } = config;
  const pageSize = pageSizeReader(effectiveConfigService);
  const publicSharingOn = sharingReader(settingsService);
  app.use(createDashboardRouter({ galleriesService, sharesService, activityService }));
  app.use(createAccountRouter({ authService, usersService, session }));
  app.use(createMyGalleriesRouter({ galleriesService, sharesService, pageSize }));
  app.use(createActivityRouter({ activityService, retentionDays: config.activity.retentionDays, pageSize }));
  app.use(createTrashRouter({ retentionDays: config.trash.retentionDays, galleriesService, pageSize }));
  const renderEdit = createGalleryEditView({
    galleriesService,
    ingestService,
    effectiveConfigService,
    sharesService,
    publicSharingOn,
    links: createLinks(config.publicUrl),
  });
  app.use(createGalleryUploadRouter({ uploadIntake, effectiveConfigService, renderEdit, tmpDir: config.tmpDir }));
  app.use(createIngestJobsRouter({ ingestService, galleriesService }));
  app.use(createGalleriesRouter({ galleriesService, sharesService, renderEdit }));
  app.use(createMediaRouter({ galleriesService, mediaStore, logger }));
}

export function mountAdminRoutes(app, context) {
  const { config, usersService, resetService, invitesService, settingsService, effectiveConfigService } = context;
  const { statsService, galleriesService, sharesService, activityService } = context;
  const links = createLinks(config.publicUrl);
  const pageSize = pageSizeReader(effectiveConfigService);
  const publicSharingOn = sharingReader(settingsService);
  const adminRouter = Router();
  adminRouter.use(createAdminOverviewRouter({ usersService, statsService, activityService }));
  adminRouter.use(createAdminGalleriesRouter({ galleriesService, sharesService, pageSize }));
  adminRouter.use(createAdminSharesRouter({ links, sharesService, publicSharingOn, pageSize }));
  adminRouter.use(
    createAdminActivityRouter({
      activityService,
      retentionDays: config.activity.retentionDays,
      pageSize,
    }),
  );
  adminRouter.use(createAdminUsersRouter({ links, usersService, resetService }));
  adminRouter.use(createAdminInvitesRouter({ links, invitesService }));
  adminRouter.use(createAdminSettingsRouter({ settingsService, effectiveConfigService }));
  app.use(ADMIN_PREFIX, requireAdmin(), adminRouter);
}
