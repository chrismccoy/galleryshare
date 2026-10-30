import { ValidationError } from '../lib/errors.js';
import { newToken } from '../lib/tokens.js';
import { hashPassword } from '../lib/password.js';
import { ENV_ADMIN_MESSAGE, isEnvAdmin } from '../domain/accounts.js';
import { MS_PER_HOUR, isoAfter, nowIso, systemNow } from '../lib/time.js';
import { createLinkLookup } from '../domain/links.js';
import { RESET_HOURS } from '../domain/limits.js';
import { NOOP_ACTIVITY } from './activity.service.js';

export function createResetService({
  runInTransaction,
  resetTokens,
  authService,
  users,
  envAdminEmail = null,
  now = systemNow,
  activityService = NOOP_ACTIVITY,
}) {
  const envAdminRefusal = (userId) => (isEnvAdmin(envAdminEmail, users.byId(userId)) ? ENV_ADMIN_MESSAGE : null);

  const links = createLinkLookup({
    byToken: resetTokens.byToken,
    kind: 'reset',
    nowIso: () => nowIso(now),
    refuse: (row) => envAdminRefusal(row.user_id),
  });
  const { problemForToken, requireUsable, useOnce } = links;

  function issue(userId, createdBy) {
    const refusal = envAdminRefusal(userId);
    if (refusal) throw new ValidationError(refusal);
    const token = newToken();
    const expiresAt = isoAfter(now(), RESET_HOURS * MS_PER_HOUR);
    runInTransaction(() => {
      resetTokens.removeUnusedForUser(userId);
      resetTokens.insert({ userId, token, createdBy, expiresAt });
    });
    activityService.record({ kind: 'resetLinkIssued', actor: createdBy, subject: userId });
    return { token, expiresAt };
  }

  async function redeem(token, password) {
    requireUsable(token);
    authService.validatePassword(password);
    const passwordHash = await hashPassword(password);
    const userId = runInTransaction(() =>
      useOnce(token, (row) => {
        if (!resetTokens.markUsed(row.id)) return false;
        authService.applyPasswordHash(row.user_id, passwordHash);
        return row.user_id;
      }),
    );
    activityService.record({ kind: 'passwordResetDone', actor: userId });
  }

  return { issue, problemForToken, redeem };
}
