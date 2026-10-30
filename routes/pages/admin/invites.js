import { Router } from 'express';
import { ADMIN_ITEM_ROUTES, ADMIN_ROUTES, PATHS } from '../../../config/urls.js';
import { formatUtc } from '../../../lib/format.js';
import { noticeFor } from '../../../lib/params.js';
import { noStore, orNotFound, renderInShell, seeOther, withFormErrors, withNotice } from '../../view/respond.js';
import { useIdParam } from '../../middleware/params.js';
import { INVITE_DAYS, MAX_INVITE_LABEL } from '../../../domain/limits.js';
import { ADMIN, USER } from '../../../domain/roles.js';

const NOTICES = { revoked: 'Invite revoked.' };
const INVITE_STATUS_TONES = Object.freeze({ pending: 'green', used: 'amber', expired: 'red', revoked: 'red' });

export function createAdminInvitesRouter({ links, invitesService }) {
  const router = Router();
  useIdParam(router);

  function render(req, res, { status = 200, error = null, link = null, form = {} } = {}) {
    const rows = invitesService.list().map((row) => {
      const token = row.copyToken;
      return {
        id: row.id,
        label: row.label,
        role: row.role,
        status: { key: row.status, text: row.status, tone: INVITE_STATUS_TONES[row.status] },
        created: formatUtc(row.created_at),
        expires: formatUtc(row.expires_at),
        url: token ? links.invite(req, token) : null,
      };
    });
    if (rows.some((row) => row.url)) noStore(res);
    return renderInShell(res.status(status), 'pages/admin/invites', {
      title: 'Invites',
      invites: rows,
      canCopy: invitesService.canShowLinks(),
      inviteDays: INVITE_DAYS,
      maxLabel: MAX_INVITE_LABEL,
      notice: noticeFor(NOTICES, req.query.notice),
      error,
      link,
      form: { role: form.role === ADMIN ? ADMIN : USER, label: form.label ?? '' },
    });
  }

  router.get(ADMIN_ROUTES.invites, (req, res) => render(req, res));

  router.post(ADMIN_ROUTES.invites, (req, res) => {
    const role = String(req.body?.role ?? USER);
    const label = String(req.body?.label ?? '').trim();
    return withFormErrors(
      res,
      () => {
        const { token, expiresAt } = invitesService.create({ role, label, createdBy: req.user.id });
        noStore(res);
        return render(req, res, {
          link: { url: links.invite(req, token), kind: 'invite', expires: formatUtc(expiresAt) },
        });
      },
      (message) => render(req, res, { status: 400, error: message, form: { role, label } }),
    );
  });

  router.post(ADMIN_ITEM_ROUTES.inviteRevoke, (req, res) =>
    orNotFound(res, () => {
      invitesService.revoke(req.idParam, req.user.id);
      return seeOther(res, withNotice(PATHS.admin.invites, 'revoked'));
    }),
  );

  return router;
}
