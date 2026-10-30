import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrf, MULTIPART_PATHS } from '../../routes/middleware/csrf.js';
import { appRoutes } from '../helpers/express-routes.js';
import { PATHS, ROUTES } from '../../config/urls.js';

test('the upload paths defer the CSRF check to after multer; other multipart POSTs are checked up front', () => {
  assert.deepEqual([...MULTIPART_PATHS], [PATHS.newGalleryUpload, ROUTES.galleryUpload]);
  const middleware = csrf({ secret: 's', secure: false });
  const outcome = (urlPath) => {
    let passed = false;
    const req = {
      method: 'POST',
      path: urlPath,
      headers: {},
      body: {},
      user: { id: 1 },
      sessionCsrf: 't',
      get: (name) => (name === 'content-type' ? 'multipart/form-data; boundary=x' : undefined),
      accepts: () => 'json',
    };
    const res = {
      locals: {},
      status: () => res,
      json: () => res,
    };
    middleware(req, res, () => {
      passed = true;
    });
    return passed;
  };
  assert.equal(outcome('/dashboard/galleries/new/upload'), true);
  assert.equal(outcome('/dashboard/galleries/12/upload'), true);
  assert.equal(outcome('/dashboard/galleries/new/images'), false, 'the old routes are gone');
  assert.equal(outcome('/dashboard/galleries/new/zip'), false);
  assert.equal(outcome('/dashboard/galleries/12/images'), false);
  assert.equal(outcome('/dashboard/galleries/12/zip'), false);
  assert.equal(outcome('/dashboard/galleries/12/upload/extra'), false);
  assert.equal(outcome('/dashboard/galleries/12/title'), false);
  assert.equal(outcome('/dashboard/galleries//upload'), false);
  assert.equal(outcome('/logout'), false);
});

test('MULTIPART_PATHS lists exactly the routes that parse multipart uploads', () => {
  const routes = appRoutes();
  const multipart = routes.filter((r) => r.handlers.some((h) => h.name === 'csrfAfterParse')).map((r) => r.path);
  assert.deepEqual([...multipart].sort(), [...MULTIPART_PATHS].sort(), 'every multipart route is in MULTIPART_PATHS');
  const registered = new Set(routes.map((r) => r.path));
  for (const pattern of MULTIPART_PATHS) assert.ok(registered.has(pattern), `${pattern} is a registered route`);
});
