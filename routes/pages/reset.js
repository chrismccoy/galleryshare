import { Router } from 'express';
import { renderPublic, seeOther, withFormErrors, withNotice } from '../view/respond.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { PATHS, ROUTES } from '../../config/urls.js';

export function createResetRouter({ resetService, publicFormLimiter, activityService }) {
  const router = Router();

  function render(req, res, { status = 200, error = null } = {}) {
    return renderPublic(res.status(status), 'pages/reset', {
      title: 'Set a new password',
      problem: resetService.problemForToken(req.params.token),
      error,
      token: req.params.token,
    });
  }

  router.get(ROUTES.reset, (req, res) => render(req, res));

  const limit = rateLimit({
    limiter: publicFormLimiter,
    key: (req) => `reset|${req.ip}`,
    onRefused: render,
    name: 'reset form',
    activityService,
  });

  router.post(ROUTES.reset, limit, (req, res) =>
    withFormErrors(
      res,
      async () => {
        await resetService.redeem(req.params.token, String(req.body?.password ?? ''));
        return seeOther(res, withNotice(PATHS.login, 'reset'));
      },
      (message) => render(req, res, { status: 400, error: message }),
    ),
  );

  return router;
}
