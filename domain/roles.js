import { deepFreeze } from '../lib/deep-freeze.js';

export const ADMIN = 'admin';

export const USER = 'user';

export const ROLES = deepFreeze([USER, ADMIN]);

export const ROLE_LABELS = deepFreeze({ [USER]: 'User', [ADMIN]: 'Admin' });

export const isRole = (role) => ROLES.includes(role);

export const isAdmin = (user) => user?.role === ADMIN;

export const mayManageOwnedBy = (user, ownerId) => Boolean(user) && (user.id === ownerId || isAdmin(user));
