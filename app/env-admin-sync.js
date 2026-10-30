import { ADMIN, isAdmin } from '../domain/roles.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { NOOP_LOGGER } from '../lib/logger.js';


export async function syncEnvAdmin({
  config,
  users,
  resetTokens,
  authService,
  runInTransaction,
  logger = NOOP_LOGGER,
}) {
  const { email, password, name } = config.admin ?? {};
  if (!email || !password) return null;

  const row = users.byEmail(email);
  if (!row) {
    users.insert({ email, displayName: name, passwordHash: await hashPassword(password), role: ADMIN });
    logger.info('env admin created', { email });
    return { created: true, promoted: false, reenabled: false, passwordChanged: false };
  }

  const promoted = !isAdmin(row);
  const reenabled = Boolean(row.disabled);
  const passwordChanged = !(await verifyPassword(password, users.passwordHashById(row.id)));
  const passwordHash = passwordChanged ? await hashPassword(password) : null;
  runInTransaction(() => {
    resetTokens.removeUnusedForUser(row.id);
    if (promoted) users.setRole(row.id, ADMIN);
    if (reenabled) users.setDisabled(row.id, false);
    if (passwordChanged) authService.applyPasswordHash(row.id, passwordHash);
  });
  if (promoted) logger.warn('env admin promoted an existing account to admin', { email, previousRole: row.role });
  if (reenabled) logger.warn('env admin re-enabled a disabled account', { email });
  logger.info(passwordChanged ? 'env admin password updated' : 'env admin unchanged', { email });
  return { created: false, promoted, reenabled, passwordChanged };
}
