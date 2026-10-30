import { delegateMethods } from '../lib/delegate.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { OWN_ACCOUNT, assertNotEnvAdmin, isEnvAdmin } from '../domain/accounts.js';
import { ADMIN, isAdmin, isRole } from '../domain/roles.js';
import { NOOP_ACTIVITY } from './activity.service.js';

const LAST_ADMIN_MESSAGE = 'At least one admin must remain.';



export function createUsersService({
  runInTransaction,
  users,
  sessions,
  invites,
  galleriesService,
  envAdminEmail = null,
  activityService = NOOP_ACTIVITY,
}) {
  const requireUser = (id) => {
    const user = users.byId(id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  };
  const assertManageable = (user) => assertNotEnvAdmin(envAdminEmail, user);
  const isEnabledAdmin = (user) => isAdmin(user) && !user.disabled;
  const guardLastAdmin = (user) => {
    if (isEnabledAdmin(user) && users.countActiveAdmins() <= 1) throw new ValidationError(LAST_ADMIN_MESSAGE);
  };
  const assertNotSelf = (id, actorId, action) => {
    if (actorId !== null && actorId !== undefined && id === actorId) throw new ValidationError(OWN_ACCOUNT[action]);
  };

  return {
    ...delegateMethods(users, ['byId', 'all', 'stats']),
    isEnvAdmin: (user) => isEnvAdmin(envAdminEmail, user),
    disable(id, actorId) {
      assertNotSelf(id, actorId, 'disable');
      const user = requireUser(id);
      assertManageable(user);
      guardLastAdmin(user);
      runInTransaction(() => {
        users.setDisabled(id, true);
        sessions.removeForUser(id);
        activityService.record({ kind: 'userDisabled', actor: actorId, subject: user });
      });
    },
    enable(id, actorId) {
      const user = requireUser(id);
      users.setDisabled(id, false);
      activityService.record({ kind: 'userEnabled', actor: actorId, subject: user });
    },
    setRole(id, role, actorId) {
      if (!isRole(role)) throw new ValidationError('Choose a valid role.');
      assertNotSelf(id, actorId, 'role');
      const user = requireUser(id);
      assertManageable(user);
      if (role !== ADMIN) guardLastAdmin(user);
      users.setRole(id, role);
      activityService.record({
        kind: 'userRoleChanged',
        actor: actorId,
        subject: user,
        details: `${user.role} → ${role}`,
      });
    },
    async remove(id, actorId) {
      assertNotSelf(id, actorId, 'remove');
      const user = requireUser(id);
      assertManageable(user);
      guardLastAdmin(user);
      const galleryIds = galleriesService.idsForUser(id);
      runInTransaction(() => {
        sessions.removeForUser(id);
        invites.revokePendingBy(id);
        users.remove(id);
      });
      activityService.record({ kind: 'userDeleted', actor: actorId, subject: user });
      await galleriesService.removeMedia(galleryIds);
    },
  };
}
