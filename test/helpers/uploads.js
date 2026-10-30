import assert from 'node:assert/strict';
import fs from 'node:fs';
import { limitOverrideKey, limitSettingKey } from '../../domain/limits.js';
import { PATHS } from '../../config/urls.js';
import { seedGallery } from './gallery-seed.js';


export function multipart(files, { csrf, field = 'files' } = {}) {
  const form = new FormData();
  if (csrf !== undefined) form.set('_csrf', csrf);
  for (const { name, data } of files) form.append(field, new Blob([data]), name);
  return form;
}

export function jobIdFrom(res) {
  return Number(res.headers.get('location').split('/').pop());
}

export function postFiles(app, session, route, files, { field = 'files', csrf = session.csrf } = {}) {
  return app.request(route, { method: 'POST', body: multipart(files, { csrf, field }), cookie: session.cookie });
}

export async function uploadGallery(app, session, files, { to = PATHS.newGalleryUpload } = {}) {
  const res = await postFiles(app, session, to, files);
  assert.equal(res.status, 303);
  await app.context.ingestService.idle();
  const jobId = jobIdFrom(res);
  const job = app.context.ingestJobs.byId(jobId);
  return { res, jobId, job, galleryId: job.gallery_id };
}

export async function seedSharedGallery(app, { files, images = 2, owner, title, description, allowZip } = {}) {
  const { context } = app;
  let session = null;
  let user;
  let galleryId;
  if (files) {
    session = await app.signedIn(owner);
    user = session.user;
    ({ galleryId } = await uploadGallery(app, session, files));
    if (title !== undefined || description !== undefined || allowZip !== undefined) {
      await context.galleriesService.saveEdits(user, galleryId, { meta: { title, description, allowZip }, images: [] });
    }
  } else {
    user = await app.createUser(owner);
    galleryId = seedGallery(context, user.id, { title, images });
  }
  const { token } = context.sharesService.share(user, galleryId);
  const shareId = context.sharesService.resolve(token).share.id;
  return { user, session, galleryId, token, shareId, images: context.galleryImages.forGallery(galleryId) };
}

export function setLimit(context, name, value) {
  context.settings.set(limitOverrideKey(name), true);
  context.settings.set(limitSettingKey(name), value);
}

export function clearLimit(context, name) {
  context.settings.set(limitOverrideKey(name), false);
}

export function withLimits(t, context, limits) {
  for (const [name, value] of Object.entries(limits)) {
    setLimit(context, name, value);
    t.after(() => clearLimit(context, name));
  }
}

export function tmpFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}
