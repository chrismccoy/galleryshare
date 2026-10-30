import { Router } from 'express';
import { InvalidCredentialsError } from '../../lib/errors.js';
import { setSessionCookie } from '../middleware/session.js';
import { renderInShell, seeOther, withFormErrors, withNotice } from '../view/respond.js';
import { noticeFor } from '../../lib/params.js';
import { PATHS } from '../../config/urls.js';

const WRONG_CURRENT = 'Your current password is incorrect.';

const NOTICES = { changed: 'Password changed.' };

const PASSWORD_CHANGED = Symbol('password changed');

export function createAccountRouter({ authService, usersService, session }) {
  const router = Router();

  function render(req, res, { status = 200, error = null, notice = null } = {}) {
    return renderInShell(res.status(status), 'pages/account', {
      title: 'Account',
      managedByEnv: usersService.isEnvAdmin(req.user),
      error,
      notice,
    });
  }

  router.get(PATHS.account, (req, res) => render(req, res, { notice: noticeFor(NOTICES, req.query.notice) }));

  router.post(PATHS.accountPassword, async (req, res) => {
    const current = String(req.body?.current ?? '');
    const newPassword = String(req.body?.next ?? '');
    const changed = await withFormErrors(
      res,
      async () => {
        await authService.changePassword(req.user.id, current, newPassword);
        return PASSWORD_CHANGED;
      },
      (message, _error, status) => render(req, res, { status, error: message }),
      { also: [{ type: InvalidCredentialsError, message: WRONG_CURRENT }] },
    );
    if (changed !== PASSWORD_CHANGED) return changed;
    const { token } = await authService.signIn(req.user.email, newPassword);
    setSessionCookie(res, session, token);
    return seeOther(res, withNotice(PATHS.account, 'changed'));
  });

  return router;
}
