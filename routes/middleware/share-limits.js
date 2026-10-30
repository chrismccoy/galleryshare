import { rateLimit } from './rate-limit.js';
import { tooManyImage, tooManyPage } from '../view/share-responses.js';


const lookupKey = (req) => `share:${req.ip}`;

const zipKey = (req) => `zip:${req.ip}`;

export function createShareLimits({ shareLimiter, zipLimiter, activityService }) {
  const lookups = { limiter: shareLimiter, key: lookupKey, name: 'share links', activityService };
  return {
    page: rateLimit({ ...lookups, onRefused: tooManyPage }),
    image: rateLimit({ ...lookups, onRefused: tooManyImage }),
    zip: rateLimit({
      limiter: zipLimiter,
      key: zipKey,
      onRefused: tooManyPage,
      name: 'ZIP downloads',
      activityService,
    }),
  };
}
