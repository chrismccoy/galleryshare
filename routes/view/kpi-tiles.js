import { ADMIN, ROLE_LABELS, USER } from '../../domain/roles.js';
import { formatBytes } from '../../lib/format.js';

export const USERS_LINE_ROLES = Object.freeze([ADMIN, USER]);

function usersLine(stats) {
  const roles = USERS_LINE_ROLES.map((role) => `${stats.byRole[role] ?? 0} ${ROLE_LABELS[role].toLowerCase()}`);
  return [...roles, `${stats.disabled} disabled`].join(', ');
}

export function toKpiTiles({ userStats, overview }) {
  return [
    {
      stat: 'users',
      label: 'Users',
      value: userStats.total,
      help: usersLine(userStats),
      tone: 'brand',
    },
    {
      stat: 'admins',
      label: 'Admins',
      value: overview.admins,
      help: 'Can manage the site',
      tone: 'brand',
    },
    {
      stat: 'galleries',
      label: 'Galleries',
      value: overview.galleries,
      help: 'Not in Trash',
      tone: 'green',
    },
    {
      stat: 'images',
      label: 'Images',
      value: overview.images,
      help: 'In galleries not in Trash',
      tone: 'green',
    },
    {
      stat: 'avg-images',
      label: 'Avg images / gallery',
      value: overview.avgImages,
      help: 'One decimal',
      tone: 'green',
    },
    {
      stat: 'storage',
      label: 'Storage used',
      value: formatBytes(overview.bytes),
      help: 'Originals, web copies and thumbnails',
      tone: 'brand',
    },
    {
      stat: 'shares',
      label: 'Live share links',
      value: overview.liveShares,
      help: 'Not revoked',
      tone: 'brand',
    },
    {
      stat: 'trashed',
      label: 'In Trash',
      value: overview.trashed,
      help: 'Galleries awaiting deletion',
      tone: 'amber',
    },
  ];
}

export function toUserKpiTiles({ galleries, images, bytes, liveLinks }) {
  return [
    { stat: 'galleries', label: 'Galleries', value: galleries, help: 'Not in Trash', tone: 'brand' },
    { stat: 'images', label: 'Images', value: images, help: 'In your galleries', tone: 'green' },
    { stat: 'storage', label: 'Storage used', value: formatBytes(bytes), help: 'Includes Trash', tone: 'amber' },
    { stat: 'shares', label: 'Live links', value: liveLinks, help: 'Shared galleries not in Trash', tone: 'sky' },
  ];
}
