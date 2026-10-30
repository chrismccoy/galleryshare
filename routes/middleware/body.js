import express from 'express';
import { LIMITS, MAX_CAPTION, MAX_TITLE } from '../../domain/limits.js';
import { BYTES_PER_MB } from '../../lib/size.js';
import { pathMatcher } from '../../lib/path-match.js';
import { ROUTES } from '../../config/urls.js';
import { BYTES_PER_KB } from '../../lib/size.js';

export const FORM_TEXT_BYTES = 64 * BYTES_PER_KB;

const DETAIL_FIELDS = 100;

const isEditFormPath = pathMatcher([ROUTES.galleryMeta]);
const EDIT_FORM_FIELDS = LIMITS.maxImagesPerGallery.max * 3 + DETAIL_FIELDS;
const EDIT_FORM_LIMIT = LIMITS.maxImagesPerGallery.max * (MAX_TITLE + MAX_CAPTION) * 3 + BYTES_PER_MB;

const isEditForm = (req) => req.method === 'POST' && isEditFormPath(req.path);

export function formBodies() {
  const formBody = express.urlencoded({ extended: false, limit: FORM_TEXT_BYTES });
  const editFormBody = express.urlencoded({
    extended: false,
    limit: EDIT_FORM_LIMIT,
    parameterLimit: EDIT_FORM_FIELDS,
  });
  const afterSession = (req, res, next) => {
    if (!isEditForm(req)) return next();
    return (req.user ? editFormBody : formBody)(req, res, next);
  };
  return {
    beforeSession: [
      (req, res, next) => (isEditForm(req) ? next() : formBody(req, res, next)),
      express.json({ limit: FORM_TEXT_BYTES }),
    ],
    afterSession,
  };
}
