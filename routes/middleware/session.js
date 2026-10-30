import { MS_PER_DAY } from '../../lib/time.js';
import { readCookie } from '../../lib/cookies.js';

export const SESSION_COOKIE = 'sid';

export function sessionCookieOptions(session) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: session.cookieSecure,
    maxAge: session.days * MS_PER_DAY,
    path: '/',
  };
}

export function sessionMiddleware(authService) {
  return (req, _res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const loaded = token ? authService.loadSession(token) : null;
    req.user = loaded?.user ?? null;
    req.sessionToken = loaded ? token : null;
    req.sessionCsrf = loaded?.csrfToken ?? null;
    next();
  };
}

export function setSessionCookie(res, session, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(session));
}

export function clearSessionCookie(res, session) {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(session);
  res.clearCookie(SESSION_COOKIE, options);
}
