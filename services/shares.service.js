import { delegateMethods } from '../lib/delegate.js';
import { mayManageOwnedBy } from '../domain/roles.js';
import { galleryTitle, isWritten } from '../domain/gallery.js';
import {
  VIEW_KINDS,
  isPreviewBot,
  isShareTokenShape,
  newNonce as randomNonce,
  shareToken,
} from '../domain/share-links.js';
import { hashToken } from '../lib/tokens.js';
import { NotFoundError, SharingOffError } from '../lib/errors.js';
import { retryOnCollision } from '../lib/sqlite-errors.js';
import { galleryEventFields } from '../domain/gallery-activity.js';
import { NOOP_ACTIVITY } from './activity.service.js';


const TOKEN_ATTEMPTS = 5;



export function createSharesService({
  shares,
  galleriesService,
  settingsService,
  secret,
  newNonce = randomNonce,
  activityService = NOOP_ACTIVITY,
}) {
  function tokenOf(row) {
    if (!row.nonce) return null;
    const token = shareToken(secret, row.nonce);
    return hashToken(token) === row.token_hash ? token : null;
  }

  const linkOf = (row) => ({ token: tokenOf(row), createdAt: row.created_at });

  const canManage = (user, galleryId) => galleriesService.canManage(user, galleryId, { includeTrashed: true });

  function findOpenableShare(token) {
    if (!isShareTokenShape(token)) return null;
    const row = shares.byToken(token);
    if (!row || row.revoked_at || !row.nonce || row.owner_disabled) return null;
    if (!settingsService.publicSharingOn()) return null;
    const gallery = galleriesService.findLive(row.gallery_id);
    return gallery ? { share: row, gallery } : null;
  }

  function recordRevoked(actorId, live) {
    if (!live) return;
    const gallery = { id: live.gallery_id, user_id: live.user_id, title: live.title };
    activityService.record({ kind: 'linkRevoked', ...galleryEventFields(actorId, gallery) });
  }

  return {
    share(user, galleryId) {
      const gallery = galleriesService.getManageable(user, galleryId);
      if (!gallery) throw new NotFoundError('Gallery to share not found');
      if (!settingsService.publicSharingOn()) throw new SharingOffError();
      const live = shares.liveForGallery(gallery.id);
      if (live) return linkOf(live);
      return retryOnCollision(TOKEN_ATTEMPTS, 'gallery_shares.token_hash', () => {
        const nonce = newNonce();
        const token = shareToken(secret, nonce);
        const id = shares.insert({ galleryId: gallery.id, token, nonce });
        activityService.record({ kind: 'linkShared', ...galleryEventFields(user, gallery) });
        return { token, createdAt: shares.byId(id).created_at };
      });
    },

    linkFor(user, galleryId) {
      if (!canManage(user, galleryId)) return null;
      const live = shares.liveForGallery(galleryId);
      return live ? linkOf(live) : null;
    },

    revokeFor(user, galleryId) {
      const live = canManage(user, galleryId) ? shares.liveForGallery(galleryId) : null;
      const detail = live ? shares.liveById(live.id) : null;
      if (!live || !shares.revoke(live.id, user.id)) throw new NotFoundError('Live link to revoke not found');
      recordRevoked(user.id, detail);
    },

    revoke(shareId, adminId) {
      const detail = shares.liveById(shareId);
      if (!shares.revoke(shareId, adminId)) throw new NotFoundError('Live share not found');
      recordRevoked(adminId, detail);
    },

    resolve(token) {
      const found = findOpenableShare(token);
      return found ? { ...found, images: galleriesService.imagesOf(found.gallery.id).filter(isWritten) } : null;
    },

    resolveImage(token, publicName) {
      const found = typeof publicName === 'string' ? findOpenableShare(token) : null;
      const image = found ? galleriesService.imageByPublicName(found.gallery.id, publicName) : null;
      return image && isWritten(image) ? { share: found.share, gallery: found.gallery, image } : null;
    },

    recordView(shareId, { ip = null, userAgent, viewer = null, ownerId, kind = VIEW_KINDS.page } = {}) {
      const insider = mayManageOwnedBy(viewer, ownerId);
      if (insider || isPreviewBot(userAgent)) return false;
      shares.recordView(shareId, { ip, userAgent, kind });
      const share = shares.liveById(shareId);
      activityService.record({
        kind: kind === VIEW_KINDS.zip ? 'zipDownloaded' : 'galleryVisited',
        actor: 'visitor',
        subject: ownerId ?? share?.user_id ?? null,
        gallery: share ? { id: share.gallery_id, title: galleryTitle(share) } : null,
        ip,
        userAgent,
      });
      return true;
    },

    detail(shareId) {
      const share = shares.liveById(shareId);
      return share ? { share, views: shares.views(shareId) } : null;
    },

    tokenForShare(shareId) {
      const row = shares.byId(shareId);
      return row && !row.revoked_at ? tokenOf(row) : null;
    },

    ...delegateMethods(shares, [
      'listLive',
      'countLive',
      'countLiveForUser',
      'liveGalleryIds',
      'liveAmong',
      'purgeViewsBefore',
    ]),
  };
}
