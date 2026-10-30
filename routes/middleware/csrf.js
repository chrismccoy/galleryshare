import { createHmac, timingSafeEqual } from 'node:crypto';
import { newToken } from '../../lib/tokens.js';
import { readCookie } from '../../lib/cookies.js';
import { jsonError, renderPublic, wantsJson } from '../view/respond.js';
import { MS_PER_HOUR, systemNow } from '../../lib/time.js';
import { PATHS, ROUTES } from '../../config/urls.js';
import { pathMatcher } from '../../lib/path-match.js';

export const PRE_COOKIE = 'pre';
export const MULTIPART_PATHS = Object.freeze([PATHS.newGalleryUpload, ROUTES.galleryUpload]);
const PRE_LIFETIME_MS = 2 * MS_PER_HOUR;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REFUSAL = 'This form has expired. Go back, reload the page and try again.';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createPreTokens(secret, now = systemNow) {
  const sign = (token, expires) =>
    createHmac('sha256', secret).update(`${PRE_COOKIE}|${token}|${expires}`).digest('base64url');

  return {
    mint() {
      const token = newToken();
      const expires = now().getTime() + PRE_LIFETIME_MS;
      return { token, cookie: `${token}.${expires}.${sign(token, expires)}` };
    },
    read(value) {
      const [token, expires, signature, ...rest] = String(value ?? '').split('.');
      if (!token || !expires || !signature || rest.length) return null;
      if (!/^\d+$/.test(expires) || Number(expires) <= now().getTime()) return null;
      return safeEqual(signature, sign(token, expires)) ? token : null;
    },
  };
}

function sentToken(req) {
  return String(req.body?._csrf || req.get('x-csrf-token') || '');
}

export function refuseCsrf(req, res) {
  if (wantsJson(req)) return jsonError(res, 403, 'Invalid or missing CSRF token.');
  return renderPublic(res.status(403), 'pages/error', { title: 'Form expired', message: REFUSAL });
}

export function csrfValid(req) {
  return Boolean(req.csrfToken) && safeEqual(sentToken(req), req.csrfToken);
}

function requireCsrf(req, res, next) {
  return csrfValid(req) ? next() : refuseCsrf(req, res);
}

export function csrf({ secret, secure, now = systemNow, multipartPaths = MULTIPART_PATHS }) {
  const pre = createPreTokens(secret, now);
  const isMultipartPath = pathMatcher(multipartPaths);
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure, maxAge: PRE_LIFETIME_MS, path: '/' };

  return (req, res, next) => {
    const safe = SAFE_METHODS.has(req.method);
    if (req.user) {
      req.csrfToken = req.sessionCsrf;
    } else {
      req.csrfToken = pre.read(readCookie(req.headers.cookie, PRE_COOKIE));
      if (!req.csrfToken && safe) {
        const minted = pre.mint();
        res.cookie(PRE_COOKIE, minted.cookie, cookieOptions);
        req.csrfToken = minted.token;
      }
    }
    res.locals.csrfToken = req.csrfToken ?? '';

    if (safe) return next();
    const multipart = (req.get('content-type') ?? '').startsWith('multipart/form-data');
    if (multipart && req.method === 'POST' && isMultipartPath(req.path)) return next();
    return requireCsrf(req, res, next);
  };
}
