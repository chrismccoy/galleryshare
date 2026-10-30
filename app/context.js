import { randomBytes } from 'node:crypto';
import { createTransactionRunner } from '../db/database.js';
import { createInvitesRepository } from '../db/invites.repository.js';
import { createResetTokensRepository } from '../db/reset-tokens.repository.js';
import { createSessionsRepository } from '../db/sessions.repository.js';
import { createSettingsRepository } from '../db/settings.repository.js';
import { createGalleriesRepository } from '../db/galleries.repository.js';
import { createGalleryImagesRepository } from '../db/gallery-images.repository.js';
import { createMediaStore } from '../media/media-store.js';
import { createGalleriesService } from '../services/galleries.service.js';
import { createIngestJobsRepository } from '../db/ingest-jobs.repository.js';
import { createIngestService } from '../services/ingest.service.js';
import { createUploadIntakeService } from '../services/upload-intake.service.js';
import { createGallerySharesRepository } from '../db/gallery-shares.repository.js';
import { createSharesService } from '../services/shares.service.js';
import { createActivityRepository } from '../db/activity.repository.js';
import { createActivityService } from '../services/activity.service.js';
import { createUsersRepository } from '../db/users.repository.js';
import { createRateLimitRepository } from '../db/rate-limit.repository.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { createLogger } from '../lib/logger.js';
import { delegateMethods } from '../lib/delegate.js';
import { createAuthService } from '../services/auth.service.js';
import { createEffectiveConfigService } from '../services/effective-config.service.js';
import { createInvitesService } from '../services/invites.service.js';
import { createSettingsService } from '../services/settings.service.js';
import { createResetService } from '../services/reset.service.js';
import { createStatsService } from '../services/stats.service.js';
import { createUsersService } from '../services/users.service.js';
import { systemNow } from '../lib/time.js';

export function resolveSecret(config, logger) {
  if (config.session.secret) return config.session.secret;
  logger.warn(
    'SESSION_SECRET is not set: using a random secret for this process, so share links and open sign-in forms stop working after a restart.',
  );
  return randomBytes(32).toString('hex');
}

export function createLimiters(repository, rateLimit, now) {
  const limiter = (max) => createRateLimiter({ repository, windowMs: rateLimit.windowMs, max, now });
  return {
    publicFormLimiter: limiter(rateLimit.publicFormMax),
    shareLimiter: limiter(rateLimit.shareMax),
    zipLimiter: limiter(rateLimit.zipMax),
  };
}


export function createRepositories(db, { now = systemNow } = {}) {
  return {
    users: createUsersRepository(db, { now }),
    sessions: createSessionsRepository(db, { now }),
    settings: createSettingsRepository(db, { now }),
    invites: createInvitesRepository(db, { now }),
    resetTokens: createResetTokensRepository(db, { now }),
    galleries: createGalleriesRepository(db, { now }),
    galleryImages: createGalleryImagesRepository(db, { now }),
    ingestJobs: createIngestJobsRepository(db, { now }),
    shares: createGallerySharesRepository(db, { now }),
    rateLimits: createRateLimitRepository(db),
    activity: createActivityRepository(db, { now }),
  };
}


export function createAppContext({
  config,
  db,
  now = systemNow,
  logger = createLogger({ now }),
  secret: givenSecret,
  repositories = createRepositories(db, { now }),
}) {
  const secret = givenSecret ?? resolveSecret(config, logger);
  const runInTransaction = createTransactionRunner(db);
  const envAdminEmail = config.admin?.email ?? null;
  const {
    users,
    sessions,
    settings,
    invites,
    resetTokens,
    galleries,
    galleryImages,
    ingestJobs,
    shares,
    rateLimits,
    activity,
  } = repositories;
  const activityService = createActivityService({
    activity,
    users,
    galleries,
    logger,
    afterCommit: runInTransaction.afterCommit,
  });

  const authService = createAuthService({
    users,
    sessions,
    runInTransaction,
    sessionDays: config.session.days,
    envAdminEmail,
    now,
    activityService,
  });
  const invitesService = createInvitesService({
    runInTransaction,
    invites,
    users,
    authService,
    encKey: config.secretsKey,
    now,
    activityService,
  });
  const resetService = createResetService({
    runInTransaction,
    resetTokens,
    authService,
    users,
    envAdminEmail,
    now,
    activityService,
  });
  const effectiveConfigService = createEffectiveConfigService({ settings, config });
  const settingsService = createSettingsService({
    runInTransaction,
    settings,
    activityService,
    envValues: { itemsPerPage: config.itemsPerPage, limits: config.limits },
  });
  const mediaStore = createMediaStore(config.mediaDir);
  const galleriesService = createGalleriesService({
    galleries,
    galleryImages,
    ingestJobs,
    mediaStore,
    effectiveConfigService,
    runInTransaction,
    logger,
    activityService,
  });
  const galleriesFor = (names) => delegateMethods(galleriesService, names);
  const sharesService = createSharesService({
    shares,
    galleriesService: galleriesFor(['canManage', 'getManageable', 'findLive', 'imagesOf', 'imageByPublicName']),
    settingsService,
    secret,
    activityService,
  });
  const ingestService = createIngestService({
    runInTransaction,
    ingestJobs,
    galleriesService: galleriesFor(['findLive', 'addProcessedImage', 'markEdited', 'canManage']),
    users,
    logger,
    activityService,
  });
  const uploadIntake = createUploadIntakeService({
    runInTransaction,
    galleriesService: galleriesFor(['getForEdit', 'imagesHeldOrReserved', 'checkUpload', 'create']),
    ingestService,
    effectiveConfigService,
    logger,
  });
  const usersService = createUsersService({
    runInTransaction,
    users,
    sessions,
    invites,
    galleriesService: galleriesFor(['idsForUser', 'removeMedia']),
    envAdminEmail,
    activityService,
  });

  const statsService = createStatsService({ users, galleries, shares });
  const { publicFormLimiter, shareLimiter, zipLimiter } = createLimiters(rateLimits, config.rateLimit, now);

  return {
    config,
    logger,
    db,
    runInTransaction,
    secret,
    now,
    users,
    sessions,
    resetTokens,
    activityService,
    mediaStore,
    authService,
    invitesService,
    resetService,
    effectiveConfigService,
    settingsService,
    galleriesService,
    sharesService,
    ingestService,
    uploadIntake,
    usersService,
    statsService,
    publicFormLimiter,
    shareLimiter,
    zipLimiter,
  };
}
