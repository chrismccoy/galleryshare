import { PATHS } from '../../config/urls.js';
import { AppError, GENERIC_ERROR_MESSAGE, isServerError, toPublicError } from '../../lib/errors.js';
import { jsonError, notFound, renderPublic, wantsJson } from '../view/respond.js';

const BODY_ERRORS = {
  'entity.too.large': { status: 413, message: 'That request is too large.' },
  'entity.parse.failed': { status: 400, message: 'That request could not be read.' },
  'parameters.too.many': { status: 413, message: 'That request is too large.' },
};

const SECRET_PATH = new RegExp(`^(${[PATHS.share, PATHS.invite, PATHS.reset].join('|')})/[^/]+`, 'i');

function loggablePath(req) {
  if (typeof req.route?.path === 'string') return `${req.baseUrl ?? ''}${req.route.path}`;
  return `${req.baseUrl ?? ''}${req.path}`.replace(SECRET_PATH, '$1/:token');
}

export function notFoundHandler(req, res) {
  return notFound(res, { api: wantsJson(req) });
}

export function errorHandler(logger) {
  return (error, req, res, _next) => {
    const known = BODY_ERRORS[error?.type];
    const { status, message } = known ?? toPublicError(error, GENERIC_ERROR_MESSAGE);
    if (isServerError(status)) {
      logger.error('request failed', {
        method: req.method,
        path: loggablePath(req),
        error: error?.name,
        detail: error instanceof AppError ? undefined : error?.message,
      });
    }
    if (res.headersSent) return res.end();
    if (wantsJson(req)) return jsonError(res, status, message);
    return renderPublic(res.status(status), 'pages/error', { title: 'Something went wrong', message });
  };
}
