export const AREAS = Object.freeze({
  accounts: 'accounts',
  galleries: 'galleries',
  sharing: 'sharing',
  settings: 'settings',
  security: 'security',
  system: 'system',
});

export const USER_HIDDEN_AREAS = Object.freeze([AREAS.security, AREAS.system]);

export const MAX_ACTIVITY_TEXT = 300;

export const EVENTS = Object.freeze({
  signedIn: Object.freeze({ area: AREAS.accounts, label: 'Signed in' }),
  signedOut: Object.freeze({ area: AREAS.accounts, label: 'Signed out' }),
  resetLinkIssued: Object.freeze({ area: AREAS.accounts, label: 'Reset link issued' }),
  passwordResetDone: Object.freeze({ area: AREAS.accounts, label: 'Password reset' }),
  passwordChanged: Object.freeze({ area: AREAS.accounts, label: 'Password changed' }),
  inviteCreated: Object.freeze({ area: AREAS.accounts, label: 'Invite created' }),
  inviteRevoked: Object.freeze({ area: AREAS.accounts, label: 'Invite revoked' }),
  inviteUsed: Object.freeze({ area: AREAS.accounts, label: 'Invite used' }),
  userDisabled: Object.freeze({ area: AREAS.accounts, label: 'User disabled' }),
  userEnabled: Object.freeze({ area: AREAS.accounts, label: 'User re-enabled' }),
  userRoleChanged: Object.freeze({ area: AREAS.accounts, label: 'User role changed' }),
  userDeleted: Object.freeze({ area: AREAS.accounts, label: 'User deleted' }),
  galleryCreated: Object.freeze({ area: AREAS.galleries, label: 'Gallery created' }),
  galleryDetailsChanged: Object.freeze({ area: AREAS.galleries, label: 'Gallery details changed' }),
  imagesAdded: Object.freeze({ area: AREAS.galleries, label: 'Images added' }),
  imageRemoved: Object.freeze({ area: AREAS.galleries, label: 'Image removed' }),
  imagesReordered: Object.freeze({ area: AREAS.galleries, label: 'Images reordered' }),
  galleryTrashed: Object.freeze({ area: AREAS.galleries, label: 'Moved to Trash' }),
  galleryRestored: Object.freeze({ area: AREAS.galleries, label: 'Gallery restored' }),
  galleryDeleted: Object.freeze({ area: AREAS.galleries, label: 'Gallery deleted' }),
  trashEmptied: Object.freeze({ area: AREAS.galleries, label: 'Trash emptied' }),
  linkShared: Object.freeze({ area: AREAS.sharing, label: 'Link shared' }),
  linkRevoked: Object.freeze({ area: AREAS.sharing, label: 'Link revoked' }),
  galleryVisited: Object.freeze({ area: AREAS.sharing, label: 'Gallery visited' }),
  zipDownloaded: Object.freeze({ area: AREAS.sharing, label: 'ZIP downloaded' }),
  publicSharingChanged: Object.freeze({ area: AREAS.sharing, label: 'Public sharing changed' }),
  settingChanged: Object.freeze({ area: AREAS.settings, label: 'Setting changed' }),
  signInFailed: Object.freeze({ area: AREAS.security, label: 'Sign-in failed' }),
  rateLimitHit: Object.freeze({ area: AREAS.security, label: 'Rate limit hit' }),
  serverStarted: Object.freeze({ area: AREAS.system, label: 'Server started' }),
  serverStopped: Object.freeze({ area: AREAS.system, label: 'Server stopped' }),
  housekeeping: Object.freeze({ area: AREAS.system, label: 'Housekeeping' }),
  demoSeeded: Object.freeze({ area: AREAS.system, label: 'Demo data written' }),
});

const UNKNOWN_BROWSER_MAX = 40;

const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

export function browserName(userAgent) {
  const text = String(userAgent ?? '').trim();
  if (!text) return null;
  const found = BROWSERS.find(([pattern]) => pattern.test(text));
  return found ? found[1] : text.slice(0, UNKNOWN_BROWSER_MAX);
}
