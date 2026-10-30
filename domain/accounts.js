import { ValidationError } from '../lib/errors.js';

export const OWN_ACCOUNT = Object.freeze({
  disable: "You can't disable your own account.",
  role: "You can't change your own role.",
  remove: "You can't delete your own account.",
});

export const ENV_ADMIN_MESSAGE = "This admin is set in .env and can't be changed here.";

export const ENV_ADMIN_DELETE_MESSAGE = "Managed in .env. This admin can't be deleted here.";

export function isEnvAdmin(envAdminEmail, user) {
  return Boolean(envAdminEmail && user && user.email === envAdminEmail);
}

export function assertNotEnvAdmin(envAdminEmail, user) {
  if (isEnvAdmin(envAdminEmail, user)) throw new ValidationError(ENV_ADMIN_MESSAGE);
}

export function accountActions({ disabled, isSelf, managedByEnv }) {
  const editable = !managedByEnv;
  return {
    canResetLink: editable,
    canEnable: editable && Boolean(disabled),
    canDisable: editable && !disabled && !isSelf,
    canDelete: editable && !isSelf,
    canChangeRole: editable && !isSelf,
    ownAccountNote: editable && isSelf,
  };
}
