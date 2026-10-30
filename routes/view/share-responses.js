import { UNAVAILABLE_MESSAGE } from '../../domain/share-links.js';
import { BRAND } from '../../config/brand.js';
import { noStore, renderPublic } from './respond.js';
import { HOME_LINK } from './app-locals.js';

export const SHARE_META = Object.freeze({
  title: `A shared gallery on ${BRAND.name}`,
  description: 'Open the link to see the gallery.',
});

export function keepPrivate(res) {
  return noStore(res).set('X-Robots-Tag', 'noindex');
}

export function shareHeaders(_req, res, next) {
  keepPrivate(res);
  next();
}

export const unavailable = (res) =>
  renderPublic(res.status(404), 'pages/share-unavailable', { title: UNAVAILABLE_MESSAGE, meta: SHARE_META });

export const tooManyPage = (_req, res, { status, error }) =>
  renderPublic(res.status(status), 'pages/error', {
    title: 'Too many requests',
    message: error,
    meta: SHARE_META,
    link: HOME_LINK,
  });

export const tooManyImage = (_req, res, { status, error }) =>
  noStore(res).status(status).type('text/plain').send(error);

export const visitOf = (req, gallery, kind) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  viewer: req.user,
  ownerId: gallery.user_id,
  kind,
});
