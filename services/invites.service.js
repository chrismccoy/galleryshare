import { NotFoundError, ValidationError } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/sqlite-errors.js';
import { hashPassword } from '../lib/password.js';
import { decrypt, encrypt } from '../lib/secret-box.js';
import { newToken } from '../lib/tokens.js';
import { boundedText } from '../lib/params.js';
import { MS_PER_DAY, isoAfter, nowIso, systemNow } from '../lib/time.js';
import { createLinkLookup } from '../domain/links.js';
import { isRole } from '../domain/roles.js';
import { INVITE_DAYS, MAX_INVITE_LABEL } from '../domain/limits.js';
import { NOOP_ACTIVITY } from './activity.service.js';

export function createInvitesService({
  runInTransaction,
  invites,
  users,
  authService,
  encKey = null,
  now = systemNow,
  activityService = NOOP_ACTIVITY,
}) {
  const links = createLinkLookup({
    byToken: invites.byToken,
    kind: 'invite',
    nowIso: () => nowIso(now),
  });
  const { statusOf, problemForToken, requireUsable, useOnce } = links;

  function create({ role, label, createdBy, expiresInDays = INVITE_DAYS }) {
    if (!isRole(role)) throw new ValidationError('Choose a role.');
    const text = boundedText(label, MAX_INVITE_LABEL, `Keep the label to ${MAX_INVITE_LABEL} characters or fewer.`, {
      blankAsNull: true,
    });
    const token = newToken();
    const expiresAt = isoAfter(now(), expiresInDays * MS_PER_DAY);
    const id = invites.insert({
      token,
      role,
      label: text,
      createdBy,
      expiresAt,
      tokenEnc: encKey ? encrypt(token, encKey) : null,
    });
    activityService.record({ kind: 'inviteCreated', actor: createdBy, details: text ?? `${role} invite` });
    return { id, token, expiresAt };
  }

  function copyTokenFor(tokenEnc, status) {
    if (!encKey || !tokenEnc || status !== 'pending') return null;
    return decrypt(tokenEnc, encKey);
  }

  const countPending = () => invites.all().filter((row) => statusOf(row) === 'pending').length;

  const list = () =>
    invites.all().map(({ token_enc: tokenEnc, ...row }) => {
      const status = statusOf(row);
      return { ...row, status, copyToken: copyTokenFor(tokenEnc, status) };
    });

  function revoke(id, actorId) {
    const invite = invites.all().find((row) => row.id === id);
    if (!invites.revoke(id)) throw new NotFoundError('Pending invite not found');
    activityService.record({
      kind: 'inviteRevoked',
      actor: actorId,
      details: invite?.label ?? (invite ? `${invite.role} invite` : null),
    });
  }

  async function redeem(token, { email, displayName, password }) {
    requireUsable(token);
    const account = authService.checkNewAccount({ email, displayName, password });
    const passwordHash = await hashPassword(password);

    const newUserId = runInTransaction(() =>
      useOnce(token, (row) => {
        let userId;
        try {
          userId = users.insert({
            email: account.email,
            displayName: account.displayName,
            passwordHash,
            role: row.role,
          });
        } catch (error) {
          if (isUniqueViolation(error, 'users.email')) {
            throw new ValidationError('An account with that email already exists.', { cause: error });
          }
          throw error;
        }
        return invites.markUsed(row.id, userId) ? userId : false;
      }),
    );
    activityService.record({ kind: 'inviteUsed', actor: newUserId, details: account.email });
    return newUserId;
  }

  const canShowLinks = () => Boolean(encKey);

  return { create, list, revoke, problemForToken, redeem, canShowLinks, countPending };
}
