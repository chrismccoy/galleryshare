import { deepFreeze } from '../lib/deep-freeze.js';

export const ADMIN_PREFIX = '/admin';

export const ADMIN_ROUTES = deepFreeze({
  overview: '/',
  users: '/users',
  invites: '/invites',
  galleries: '/galleries',
  shares: '/shares',
  activity: '/activity',
  settings: '/settings',
});

const ADMIN_PATHS = Object.fromEntries(
  Object.entries(ADMIN_ROUTES).map(([key, route]) => [key, route === '/' ? ADMIN_PREFIX : `${ADMIN_PREFIX}${route}`]),
);

export const PATHS = deepFreeze({
  front: '/',
  login: '/login',
  logout: '/logout',
  account: '/account',
  accountPassword: '/account/password',
  dashboard: '/dashboard',
  galleries: '/dashboard/galleries',
  newGallery: '/dashboard/galleries/new',
  newGalleryUpload: '/dashboard/galleries/new/upload',
  trash: '/dashboard/trash',
  trashEmpty: '/dashboard/trash/empty',
  activity: '/dashboard/activity',
  ingestJobs: '/dashboard/galleries/jobs',
  media: '/media',
  share: '/s',
  invite: '/invite',
  reset: '/reset',
  admin: ADMIN_PATHS,
});

export const ROUTES = deepFreeze({
  gallery: `${PATHS.galleries}/:id`,
  galleryMeta: `${PATHS.galleries}/:id/meta`,
  galleryUpload: `${PATHS.galleries}/:id/upload`,
  galleryShare: `${PATHS.galleries}/:id/share`,
  galleryUnshare: `${PATHS.galleries}/:id/unshare`,
  galleryDelete: `${PATHS.galleries}/:id/delete`,
  galleryReorder: `${PATHS.galleries}/:id/reorder`,
  galleryImageRemove: `${PATHS.galleries}/:id/images/:imageId/remove`,
  ingestJob: `${PATHS.ingestJobs}/:id`,
  trashRestore: `${PATHS.trash}/:id/restore`,
  trashPurge: `${PATHS.trash}/:id/purge`,
  media: `${PATHS.media}/:imageId/:size`,
  invite: `${PATHS.invite}/:token`,
  reset: `${PATHS.reset}/:token`,
  share: `${PATHS.share}/:token`,
  shareZip: `${PATHS.share}/:token/zip`,
  shareImage: `${PATHS.share}/:token/i/:publicName`,
  shareImageFile: `${PATHS.share}/:token/i/:publicName/:file`,
});

export const ADMIN_ITEM_ROUTES = deepFreeze({
  user: `${ADMIN_ROUTES.users}/:id`,
  userResetLink: `${ADMIN_ROUTES.users}/:id/reset-link`,
  userDisable: `${ADMIN_ROUTES.users}/:id/disable`,
  userEnable: `${ADMIN_ROUTES.users}/:id/enable`,
  userRole: `${ADMIN_ROUTES.users}/:id/role`,
  userDelete: `${ADMIN_ROUTES.users}/:id/delete`,
  share: `${ADMIN_ROUTES.shares}/:id`,
  shareRevoke: `${ADMIN_ROUTES.shares}/:id/revoke`,
  inviteRevoke: `${ADMIN_ROUTES.invites}/:id/revoke`,
});

function itemPath(prefix) {
  return (id, action) => {
    const item = `${prefix}/${encodeURIComponent(id)}`;
    return action ? `${item}/${action}` : item;
  };
}

export const PATH_TO = Object.freeze({
  login: (next) => (!next || next === PATHS.front ? PATHS.login : `${PATHS.login}?next=${encodeURIComponent(next)}`),
  gallery: itemPath(PATHS.galleries),
  galleryImage: (galleryId, imageId, action) =>
    itemPath(`${PATHS.galleries}/${encodeURIComponent(galleryId)}/images`)(imageId, action),
  ingestJob: itemPath(PATHS.ingestJobs),
  trashItem: itemPath(PATHS.trash),
  media: (imageId, size) => `${PATHS.media}/${encodeURIComponent(imageId)}/${size}`,
  share: (token) => `${PATHS.share}/${encodeURIComponent(token)}`,
  shareImage: (token, publicName, size) =>
    `${PATH_TO.shareImagePage(token, publicName)}${size === 'web' ? '' : `-${size}`}.webp`,
  shareImagePage: (token, publicName) => `${PATH_TO.share(token)}/i/${encodeURIComponent(publicName)}`,
  shareZip: (token) => `${PATH_TO.share(token)}/zip`,
  invite: (token) => `${PATHS.invite}/${encodeURIComponent(token)}`,
  reset: (token) => `${PATHS.reset}/${encodeURIComponent(token)}`,
  asset: (file) => `/${file}`,
  adminUser: itemPath(ADMIN_PATHS.users),
  adminInvite: itemPath(ADMIN_PATHS.invites),
  adminShare: itemPath(ADMIN_PATHS.shares),
});
