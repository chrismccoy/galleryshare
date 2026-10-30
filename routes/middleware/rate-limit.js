import { jsonError } from '../view/respond.js';

export const TOO_MANY = 'Too many attempts. Try again in a few minutes.';



const TOO_MANY_STATUS = 429;

const jsonRefusal = (_req, res, { status, error }) => jsonError(res, status, error);

export function rateLimit({
  limiter,
  key = (req) => req.ip ?? 'unknown',
  message = TOO_MANY,
  onRefused = jsonRefusal,
  name = 'rate limit',
  activityService = undefined,
}) {
  return (req, res, next) => {
    const { allowed, remaining, resetInSeconds, firstRefusal } = limiter.check(key(req));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetInSeconds));
    if (allowed) return next();
    res.setHeader('Retry-After', String(resetInSeconds));
    if (firstRefusal) {
      activityService?.record({
        kind: 'rateLimitHit',
        actor: 'visitor',
        details: name,
        ip: req.ip,
        userAgent: req.get?.('user-agent'),
      });
    }
    return onRefused(req, res, { status: TOO_MANY_STATUS, error: message, resetInSeconds });
  };
}
