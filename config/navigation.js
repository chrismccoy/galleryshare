import { deepFreeze } from '../lib/deep-freeze.js';
import { isAdmin } from '../domain/roles.js';
import { PATHS } from './urls.js';



export const NAV_GROUPS = deepFreeze([
  {
    key: 'main',
    title: 'Main',
    links: [
      { key: 'dashboard', label: 'Dashboard', href: PATHS.dashboard, icon: 'fa-solid fa-gauge-high' },
      {
        key: 'activity',
        label: 'My activity',
        href: PATHS.activity,
        icon: 'fa-solid fa-clock-rotate-left',
        badgeKey: 'activity',
      },
      {
        key: 'new-gallery',
        label: 'Add gallery',
        href: PATHS.newGallery,
        icon: 'fa-solid fa-images',
        activeOn: [`${PATHS.newGallery}/`],
      },
      {
        key: 'galleries',
        label: 'My galleries',
        href: PATHS.galleries,
        icon: 'fa-solid fa-table-cells',
        activeOn: [`${PATHS.galleries}/`, `${PATHS.ingestJobs}/`],
        activeExcept: [PATHS.newGallery],
        badgeKey: 'galleries',
      },
      { key: 'trash', label: 'Trash', href: PATHS.trash, icon: 'fa-regular fa-trash-can', badgeKey: 'trash' },
      { key: 'account', label: 'Account', href: PATHS.account, icon: 'fa-solid fa-user' },
    ],
  },
  {
    key: 'admin',
    title: 'Admin',
    admin: true,
    links: [
      { key: 'admin', label: 'Overview', href: PATHS.admin.overview, icon: 'fa-solid fa-chart-simple' },
      {
        key: 'admin-activity',
        label: 'Activity',
        href: PATHS.admin.activity,
        icon: 'fa-solid fa-clock-rotate-left',
        badgeKey: 'allActivity',
      },
      { key: 'admin-users', label: 'Users', href: PATHS.admin.users, icon: 'fa-solid fa-users', badgeKey: 'users' },
      {
        key: 'admin-invites',
        label: 'Invites',
        href: PATHS.admin.invites,
        icon: 'fa-solid fa-user-plus',
        badgeKey: 'invites',
      },
      {
        key: 'admin-galleries',
        label: 'Galleries',
        href: PATHS.admin.galleries,
        icon: 'fa-solid fa-photo-film',
        badgeKey: 'allGalleries',
      },
      {
        key: 'admin-shares',
        label: 'Shared links',
        href: PATHS.admin.shares,
        icon: 'fa-solid fa-link',
        badgeKey: 'shares',
      },
      { key: 'admin-settings', label: 'Settings', href: PATHS.admin.settings, icon: 'fa-solid fa-gear' },
    ],
  },
]);

export function isNavActive(link, currentPath) {
  if (currentPath === link.href) return true;
  if ((link.activeExcept ?? []).some((except) => currentPath === except || currentPath.startsWith(`${except}/`))) {
    return false;
  }
  return (link.activeOn ?? []).some((prefix) => currentPath.startsWith(prefix));
}

export function navFor(user) {
  if (!user) return [];
  return NAV_GROUPS.filter((group) => !group.admin || isAdmin(user));
}
