import path from 'node:path';
import express from 'express';
import { PUBLIC_DIR, SCREENSHOTS_DIR, SCREENSHOTS_PATH } from '../../config/root.js';
import { MS_PER_DAY, MS_PER_SECOND } from '../../lib/time.js';

const NOINDEX = 'noindex, nofollow';

const SCREENSHOTS_FOLDER = SCREENSHOTS_PATH.slice(1).toLowerCase();

export function isGalleryPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return true;
  }
  const first =
    decoded
      .replaceAll('\\', '/')
      .split('/')
      .find((part) => part !== '') ?? '';
  return first.toLowerCase() === SCREENSHOTS_FOLDER;
}

const isGalleryFile = (file) => path.relative(PUBLIC_DIR, file).split(path.sep)[0].toLowerCase() === SCREENSHOTS_FOLDER;

export function publicFiles() {
  const serve = express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, file) => {
      if (isGalleryFile(file)) res.set('X-Robots-Tag', NOINDEX);
    },
  });
  return (req, res, next) => (isGalleryPath(req.path) ? next() : serve(req, res, next));
}

export function screenshotFiles() {
  return [
    (_req, res, next) => {
      res.set('X-Robots-Tag', NOINDEX);
      next();
    },
    express.static(SCREENSHOTS_DIR, { index: 'index.html' }),
  ];
}

const FAVICON_MAX_AGE = MS_PER_DAY / MS_PER_SECOND;

export function noFavicon(_req, res) {
  res.set('Cache-Control', `public, max-age=${FAVICON_MAX_AGE}`).status(204).end();
}
