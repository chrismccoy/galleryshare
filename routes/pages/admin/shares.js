import { Router } from 'express';
import { ADMIN_ITEM_ROUTES, ADMIN_ROUTES, PATHS } from '../../../config/urls.js';
import { galleryTitle } from '../../../domain/gallery.js';
import { formatUtc } from '../../../lib/format.js';
import { noticeFor } from '../../../lib/params.js';
import { noStore, notFound, orNotFound, renderInShell, seeOther, withNotice } from '../../view/respond.js';
import { useIdParam } from '../../middleware/params.js';
import { listPage } from '../../view/list-page.js';
import { PAUSE_REASONS, VIEW_KINDS, pauseReason } from '../../../domain/share-links.js';

const NOTICES = { revoked: 'Share link revoked.' };

const USER_AGENT_SHOWN = 120;
const CLICKS_NOTE = 'Click counts are approximate: link previews and known bots are skipped.';
const KIND_LABELS = { [VIEW_KINDS.page]: 'Page', [VIEW_KINDS.zip]: 'ZIP' };

const PAUSE_STATUS = Object.freeze({
  [PAUSE_REASONS.trash]: { text: 'Paused: in Trash', tone: 'amber' },
  [PAUSE_REASONS.ownerDisabled]: { text: 'Paused: owner disabled', tone: 'amber' },
});
const LIVE_STATUS = Object.freeze({ text: 'Live', tone: 'green' });

const statusOf = (row) => PAUSE_STATUS[pauseReason(row)] ?? LIVE_STATUS;

export function createAdminSharesRouter({ links, sharesService, publicSharingOn, pageSize }) {
  const router = Router();
  useIdParam(router);

  const viewUrl = (req, shareId) => {
    const token = sharesService.tokenForShare(shareId);
    return token ? links.share(req, token) : null;
  };

  const toShareView = (req, row) => ({
    id: row.id,
    owner: row.owner_name,
    gallery: galleryTitle(row),
    shared: formatUtc(row.created_at),
    clicks: row.view_count,
    lastOpened: row.last_viewed_at ? formatUtc(row.last_viewed_at) : 'Never',
    status: statusOf(row),
    url: viewUrl(req, row.id),
  });

  router.get(ADMIN_ROUTES.shares, (req, res) => {
    const { rows: shown, olderUrl } = listPage(req, {
      pageSize: pageSize(),
      path: PATHS.admin.shares,
      fetch: ({ beforeId, limit }) => sharesService.listLive({ beforeId, limit }),
    });
    noStore(res);
    return renderInShell(res, 'pages/admin/shares', {
      title: 'Shared links',
      rows: shown.map((row) => toShareView(req, row)),
      sharingOn: publicSharingOn(),
      olderUrl,
      notice: noticeFor(NOTICES, req.query.notice),
      clicksNote: CLICKS_NOTE,
    });
  });

  router.get(ADMIN_ITEM_ROUTES.share, (req, res) => {
    const found = sharesService.detail(req.idParam);
    if (!found) return notFound(res);
    const { share, views } = found;
    noStore(res);
    return renderInShell(res, 'pages/admin/share', {
      title: 'Shared link',
      share: { ...toShareView(req, share), galleryId: share.gallery_id, ownerEmail: share.owner_email },
      views: views.map((view) => ({
        when: formatUtc(view.viewed_at),
        kind: KIND_LABELS[view.kind] ?? view.kind,
        ip: view.ip ?? '',
        userAgent: (view.user_agent ?? '').slice(0, USER_AGENT_SHOWN),
      })),
      sharingOn: publicSharingOn(),
      clicksNote: CLICKS_NOTE,
    });
  });

  router.post(ADMIN_ITEM_ROUTES.shareRevoke, (req, res) =>
    orNotFound(res, () => {
      sharesService.revoke(req.idParam, req.user.id);
      return seeOther(res, withNotice(PATHS.admin.shares, 'revoked'));
    }),
  );

  return router;
}
