import { Router } from 'express';
import { InvalidCredentialsError } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/email.js';
import { renderPublic, seeOther, withFormErrors } from '../view/respond.js';
import { noticeFor } from '../../lib/params.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/session.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

const NOTICES = { reset: 'Password updated. Sign in with your new password.' };

function safeNext(nextPath) {
  if (
    typeof nextPath !== 'string' ||
    !nextPath.startsWith('/') ||
    nextPath.startsWith('//') ||
    nextPath.includes('\\')
  ) {
    return PATHS.front;
  }
  return nextPath;
}

export function createAuthRouter({ authService, session, publicFormLimiter, activityService }) {
  const router = Router();

  function render(req, res, { status = 200, error = null } = {}) {
    const next = safeNext(req.query.next);
    return renderPublic(res.status(status), 'pages/login', {
      title: 'Sign in',
      error,
      notice: noticeFor(NOTICES, req.query.notice),
      email: String(req.body?.email ?? ''),
      action: PATH_TO.login(next),
    });
  }

  router.get(PATHS.login, (req, res) => {
    if (req.user) return seeOther(res, PATHS.front);
    return render(req, res);
  });

  const limit = rateLimit({
    limiter: publicFormLimiter,
    key: (req) => `login|${req.ip}|${normalizeEmail(req.body?.email)}`,
    onRefused: render,
    name: 'sign-in form',
    activityService,
  });

  router.post(PATHS.login, limit, (req, res) =>
    withFormErrors(
      res,
      async () => {
        const email = normalizeEmail(req.body?.email);
        const from = { ip: req.ip, userAgent: req.get('user-agent') };
        let signedIn;
        try {
          signedIn = await authService.signIn(email, String(req.body?.password ?? ''));
        } catch (error) {
          if (error instanceof InvalidCredentialsError) {
            activityService.record({ kind: 'signInFailed', actor: 'visitor', details: email, ...from });
          }
          throw error;
        }
        activityService.record({ kind: 'signedIn', actor: signedIn.user, ...from });
        setSessionCookie(res, session, signedIn.token);
        return seeOther(res, safeNext(req.query.next));
      },
      (message) => render(req, res, { status: 400, error: message }),
      { also: [InvalidCredentialsError] },
    ),
  );

  router.post(PATHS.logout, (req, res) => {
    if (req.sessionToken) {
      const { user } = req;
      authService.signOut(req.sessionToken);
      if (user) activityService.record({ kind: 'signedOut', actor: user });
    }
    clearSessionCookie(res, session);
    return seeOther(res, PATHS.login);
  });

  return router;
}
