import { randomUUID } from 'node:crypto';
import { MS_PER_HOUR, isoAfter } from '../../lib/time.js';
import { newToken } from '../../lib/tokens.js';
import { createUsersRepository } from '../../db/users.repository.js';

export function insertBareUser(
  db,
  { email = `user-${randomUUID().slice(0, 8)}@example.com`, role = 'user', displayName = email } = {},
) {
  return createUsersRepository(db).insert({ email, displayName, passwordHash: 'x', role });
}

export function insertBareUserRow(context, options) {
  return context.users.byId(insertBareUser(context.db, options));
}

export const ENV_ADMIN = Object.freeze({ email: 'owner@example.com', password: 'owner long password' });

export function legacyResetLink(context, { userId }) {
  const token = newToken();
  context.resetTokens.insert({
    userId,
    token,
    createdBy: null,
    expiresAt: isoAfter(context.now(), MS_PER_HOUR),
  });
  return token;
}

export function openSession(sessions, { userId, expiresAt }) {
  const token = newToken();
  const csrfToken = newToken();
  sessions.insert({ userId, token, csrfToken, expiresAt });
  return { token, csrfToken };
}
