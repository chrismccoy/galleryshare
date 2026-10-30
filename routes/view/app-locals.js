import { MIN_PASSWORD_LENGTH } from '../../domain/limits.js';
import { ROLES, ROLE_LABELS, isAdmin } from '../../domain/roles.js';
import { plural } from '../../lib/plural.js';
import { shareThemePartial } from '../../domain/share-themes.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { BRAND } from '../../config/brand.js';
import { pct } from '../../lib/format.js';

export function humanize(value) {
  return String(value ?? '').replaceAll('_', ' ');
}

export function backLink(user) {
  return user ? { href: PATHS.dashboard, label: 'Back to dashboard' } : { href: PATHS.login, label: 'Back to sign in' };
}

export const HOME_LINK = Object.freeze({ href: PATHS.front, label: `Go to ${BRAND.name}` });

export const APP_LOCALS = Object.freeze({
  roles: ROLES,
  roleLabels: ROLE_LABELS,
  paths: PATHS,
  pathTo: PATH_TO,
  isAdminUser: isAdmin,
  minPassword: MIN_PASSWORD_LENGTH,
  backLink,
  homeLink: HOME_LINK,
  humanize,
  plural,
  pct,
  shareThemePartial,
});
