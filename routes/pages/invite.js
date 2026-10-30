import { Router } from 'express';
import { renderPublic, seeOther, withFormErrors } from '../view/respond.js';
import { setSessionCookie } from '../middleware/session.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { MAX_DISPLAY_NAME } from '../../domain/limits.js';
import { normalizeEmail } from '../../lib/email.js';
import { PATHS, ROUTES } from '../../config/urls.js';

export function createInviteRouter({ authService, session, invitesService, publicFormLimiter, activityService }) {
  const router = Router();

  function render(req, res, { status = 200, error = null } = {}) {
    return renderPublic(res.status(status), 'pages/invite', {
      title: 'Create your account',
      maxDisplayName: MAX_DISPLAY_NAME,
      problem: invitesService.problemForToken(req.params.token),
      error,
      token: req.params.token,
      form: {
        display_name: String(req.body?.display_name ?? ''),
        email: String(req.body?.email ?? ''),
      },
    });
  }

  router.get(ROUTES.invite, (req, res) => render(req, res));

  const limit = rateLimit({
    limiter: publicFormLimiter,
    key: (req) => `invite|${req.ip}`,
    onRefused: render,
    name: 'invite form',
    activityService,
  });

  router.post(ROUTES.invite, limit, (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    return withFormErrors(
      res,
      async () => {
        await invitesService.redeem(req.params.token, {
          email,
          displayName: req.body?.display_name,
          password,
        });
        const { token } = await authService.signIn(email, password);
        setSessionCookie(res, session, token);
        return seeOther(res, PATHS.front);
      },
      (message) => render(req, res, { status: 400, error: message }),
    );
  });

  return router;
}
