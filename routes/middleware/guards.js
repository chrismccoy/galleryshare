import { jsonError, notFound, seeOther, wantsJson } from '../view/respond.js';
import { isAdmin } from '../../domain/roles.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

function refuseAnonymous(req, res, api) {
  if (api || wantsJson(req)) return jsonError(res, 401, 'Sign in to continue.');
  const replayable = req.method === 'GET' || req.method === 'HEAD';
  const path = replayable ? (req.originalUrl ?? PATHS.front) : PATHS.front;
  return seeOther(res, PATH_TO.login(path));
}

export function requireUser({ api = false } = {}) {
  return (req, res, next) => {
    if (!req.user) return refuseAnonymous(req, res, api);
    return next();
  };
}

export function requireAdmin({ api = false } = {}) {
  return (req, res, next) => {
    if (!req.user) return refuseAnonymous(req, res, api);
    if (!isAdmin(req.user)) return notFound(res, { api });
    return next();
  };
}
