import { Router } from 'express';
import { ADMIN_ITEM_ROUTES, ADMIN_ROUTES, PATHS, PATH_TO } from '../../../config/urls.js';
import { formatUtc } from '../../../lib/format.js';
import { noticeFor } from '../../../lib/params.js';
import { noStore, notFound, renderInShell, seeOther, withFormErrors, withNotice } from '../../view/respond.js';
import { useIdParam } from '../../middleware/params.js';
import { ENV_ADMIN_DELETE_MESSAGE, OWN_ACCOUNT, accountActions } from '../../../domain/accounts.js';
import { isAdmin } from '../../../domain/roles.js';

const NOTICES = {
  disabled: 'Account disabled.',
  enabled: 'Account enabled.',
  role: 'Role updated.',
  deleted: 'User deleted.',
};

export function accountStatus(disabled) {
  return disabled ? { text: 'Disabled', tone: 'red' } : { text: 'Active', tone: 'green' };
}

export function createAdminUsersRouter({ links, usersService, resetService }) {
  const router = Router();
  useIdParam(router);
  router.param('id', (req, res, next) => {
    req.targetUser = usersService.byId(req.idParam);
    return req.targetUser ? next() : notFound(res);
  });

  function renderUser(req, res, target, { status = 200, error = null, link = null } = {}) {
    const isSelf = target.id === req.user.id;
    const managedByEnv = usersService.isEnvAdmin(target);
    return renderInShell(res.status(status), 'pages/admin/user', {
      title: target.display_name,
      target,
      accountStatus: accountStatus(target.disabled),
      ...accountActions({ disabled: target.disabled, isSelf, managedByEnv }),
      joined: formatUtc(target.created_at),
      notice: noticeFor(NOTICES, req.query.notice),
      error,
      link,
    });
  }

  function withTargetUser(handler) {
    return (req, res) =>
      withFormErrors(
        res,
        () => handler(req, res, req.targetUser),
        (message, _error, status) => renderUser(req, res, req.targetUser, { status, error: message }),
      );
  }

  router.get(ADMIN_ROUTES.users, (req, res) => {
    const rows = usersService.all().map((user) => ({
      id: user.id,
      name: user.display_name,
      email: user.email,
      role: user.role,
      admin: isAdmin(user),
      status: accountStatus(user.disabled),
      joined: formatUtc(user.created_at),
    }));
    return renderInShell(res, 'pages/admin/users', {
      title: 'Users',
      rows,
      notice: noticeFor(NOTICES, req.query.notice),
    });
  });

  router.get(ADMIN_ITEM_ROUTES.user, (req, res) => renderUser(req, res, req.targetUser));

  router.post(
    ADMIN_ITEM_ROUTES.userResetLink,
    withTargetUser((req, res, target) => {
      const { token, expiresAt } = resetService.issue(target.id, req.user.id);
      noStore(res);
      return renderUser(req, res, target, {
        link: { url: links.reset(req, token), kind: 'reset', expires: formatUtc(expiresAt) },
      });
    }),
  );

  router.post(
    ADMIN_ITEM_ROUTES.userDisable,
    withTargetUser((req, res, target) => {
      usersService.disable(target.id, req.user.id);
      return seeOther(res, withNotice(PATH_TO.adminUser(target.id), 'disabled'));
    }),
  );

  router.post(
    ADMIN_ITEM_ROUTES.userEnable,
    withTargetUser((req, res, target) => {
      usersService.enable(target.id, req.user.id);
      return seeOther(res, withNotice(PATH_TO.adminUser(target.id), 'enabled'));
    }),
  );

  router.post(
    ADMIN_ITEM_ROUTES.userRole,
    withTargetUser((req, res, target) => {
      usersService.setRole(target.id, String(req.body?.role ?? ''), req.user.id);
      return seeOther(res, withNotice(PATH_TO.adminUser(target.id), 'role'));
    }),
  );

  router.get(ADMIN_ITEM_ROUTES.userDelete, (req, res) => {
    const { targetUser: target } = req;
    return renderInShell(res, 'pages/admin/user-delete', {
      title: 'Delete user',
      target,
      isSelf: target.id === req.user.id,
      managedByEnv: usersService.isEnvAdmin(target),
      ownAccountMessage: OWN_ACCOUNT.remove,
      envAdminMessage: ENV_ADMIN_DELETE_MESSAGE,
      error: null,
    });
  });

  router.post(
    ADMIN_ITEM_ROUTES.userDelete,
    withTargetUser(async (req, res, target) => {
      await usersService.remove(target.id, req.user.id);
      return seeOther(res, withNotice(PATHS.admin.users, 'deleted'));
    }),
  );

  return router;
}
