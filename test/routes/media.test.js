import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { startApp } from '../helpers/http.js';
import { makeJpeg } from '../helpers/images.js';
import { uploadGallery } from '../helpers/uploads.js';
import { PATH_TO } from '../../config/urls.js';
import { assertSignInRedirect } from '../helpers/assertions.js';

let app;
let owner;
let galleryId;
let imageId;
before(async () => {
  app = await startApp({}, { media: 'gs-media-' });
  owner = await app.signedIn();
  ({ galleryId } = await uploadGallery(app, owner, [
    { name: 'big.jpg', data: await makeJpeg({ width: 1200, height: 900 }) },
  ]));
  [{ id: imageId }] = app.context.galleryImages.forGallery(galleryId);
});
after(() => app.close());

test('/media/:id/thumb returns image/webp for the owner and sends a signed-out visitor to sign in', async () => {
  const res = await app.request(PATH_TO.media(imageId, 'thumb'), { cookie: owner.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=3600');
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(Math.max(meta.width, meta.height), 600);

  const web = await app.request(PATH_TO.media(imageId, 'web'), { cookie: owner.cookie });
  assert.equal(web.status, 200);
  assert.equal((await sharp(Buffer.from(await web.arrayBuffer())).metadata()).width, 1200);

  await assertSignInRedirect(app, PATH_TO.media(imageId, 'thumb'));
});

test('no original, unknown size or unknown image is served', async () => {
  for (const pathname of [
    PATH_TO.media(imageId, 'orig'),
    PATH_TO.media(imageId, 'big'),
    '/media/999999/thumb',
    '/media/abc/thumb',
  ]) {
    assert.equal(await app.status(pathname, { cookie: owner.cookie }), 404, pathname);
  }
});

test('an admin may view any image; another user may not', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  assert.equal(await app.status(PATH_TO.media(imageId, 'thumb'), { cookie: admin.cookie }), 200);
  const other = await app.signedIn();
  assert.equal(await app.status(PATH_TO.media(imageId, 'thumb'), { cookie: other.cookie }), 404);
});

test('a missing media file is a 404, not a crash', async (t) => {
  const image = app.context.galleryImages.byId(imageId);
  const file = app.context.mediaStore.paths({ galleryId, imageId, ext: image.ext }).web;
  const saved = fs.readFileSync(file);
  fs.rmSync(file);
  t.after(() => fs.writeFileSync(file, saved));
  assert.equal(await app.status(PATH_TO.media(imageId, 'web'), { cookie: owner.cookie }), 404);
});

test('the owner still sees thumbnails of a gallery in Trash', async (t) => {
  app.context.galleries.trashOwned(galleryId, owner.user.id);
  t.after(() => app.context.galleries.restoreOwned(galleryId, owner.user.id));
  assert.equal(await app.status(PATH_TO.media(imageId, 'thumb'), { cookie: owner.cookie }), 200);
});

test('a read error after the stream opens (file gone) is a 404 when nothing was sent yet', async (t) => {
  t.mock.method(app.context.mediaStore, 'stream', () => fs.createReadStream(path.join(app.root, 'vanished.webp')));
  assert.equal(await app.status(PATH_TO.media(imageId, 'thumb'), { cookie: owner.cookie }), 404);
});
