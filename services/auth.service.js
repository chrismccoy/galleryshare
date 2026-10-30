import { InvalidCredentialsError, ValidationError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { MS_PER_DAY, systemNow } from '../lib/time.js';
import { EMAIL_PATTERN, normalizeEmail } from '../lib/email.js';
import { newToken } from '../lib/tokens.js';
import { boundedText } from '../lib/params.js';
import { assertNotEnvAdmin } from '../domain/accounts.js';
import { MAX_DISPLAY_NAME, MIN_PASSWORD_LENGTH } from '../domain/limits.js';
import { NOOP_ACTIVITY } from './activity.service.js';

export function createAuthService({
  users,
  sessions,
  runInTransaction,
  sessionDays,
  envAdminEmail = null,
  now = systemNow,
  activityService = NOOP_ACTIVITY,
}) {
  function issueSession(userId) {
    const token = newToken();
    const csrfToken = newToken();
    sessions.insert({ userId, token, csrfToken, expiresAt: new Date(now().getTime() + sessionDays * MS_PER_DAY) });
    return { token, csrfToken };
  }

  function applyPasswordHash(userId, passwordHash) {
    runInTransaction(() => {
      users.setPassword(userId, passwordHash);
      sessions.removeForUser(userId);
    });
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  async function signIn(email, password) {
    const user = users.byEmail(email);
    if (!user) {
      await hashPassword(String(password));
      throw new InvalidCredentialsError('no account for that email');
    }
    const ok = await verifyPassword(String(password), users.passwordHashById(user.id));
    if (!ok) throw new InvalidCredentialsError(`wrong password for user ${user.id}`);
    if (user.disabled) throw new InvalidCredentialsError(`user ${user.id} is disabled`);
    const { token, csrfToken } = issueSession(user.id);
    return { token, csrfToken, user };
  }

  const signOut = (token) => sessions.remove(token);

  function loadSession(token) {
    if (!token) return null;
    const session = sessions.liveByToken(token);
    if (!session) return null;
    const user = users.byId(session.user_id);
    if (!user || user.disabled) return null;
    return { user, csrfToken: session.csrf_token };
  }

  async function setPassword(userId, password) {
    validatePassword(password);
    applyPasswordHash(userId, await hashPassword(password));
  }

  async function changePassword(userId, current, next) {
    const user = users.byId(userId);
    assertNotEnvAdmin(envAdminEmail, user);
    if (!user || !(await verifyPassword(String(current), users.passwordHashById(user.id)))) {
      throw new InvalidCredentialsError(`wrong current password for user ${userId}`);
    }
    await setPassword(userId, next);
    activityService.record({ kind: 'passwordChanged', actor: user });
  }

  function checkNewAccount({ email, displayName, password }) {
    const name = boundedText(displayName, MAX_DISPLAY_NAME, 'Enter your name.', { required: true });
    validatePassword(password);
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) throw new ValidationError('Enter your email address.');
    if (!EMAIL_PATTERN.test(cleanEmail)) throw new ValidationError('Enter a valid email address.');
    return { email: cleanEmail, displayName: name };
  }

  return {
    signIn,
    signOut,
    loadSession,
    changePassword,
    setPassword,
    applyPasswordHash,
    validatePassword,
    checkNewAccount,
  };
}
