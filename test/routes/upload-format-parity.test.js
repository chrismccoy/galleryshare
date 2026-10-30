import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PROJECT_ROOT } from '../../config/root.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import {
  IMAGE_FORMATS,
  UNSUPPORTED_UPLOAD_MESSAGE,
  UPLOAD_ACCEPT,
  ZIP_EXTENSIONS,
  ZIP_TYPES,
  uploadKind,
} from '../../media/image-types.js';
import { decodeEntities, startApp } from '../helpers/http.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

function uploadFormAttrs(html) {
  const tag = html.match(/<form [^>]*data-upload-form[^>]*>/)?.[0];
  assert.ok(tag, 'the page has the upload form');
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2])]));
}

function datasetOf(attrs) {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]),
  );
}

function browserRules() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'gallery-upload-rules.js'), 'utf8');
  const sandbox = {
    document: {
      querySelector: () => null,
    },
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.galleryUploadRules, 'function', 'the script defines galleryUploadRules');
  return sandbox.galleryUploadRules;
}

const CASES = [
  ...IMAGE_FORMATS.flatMap((format) => [
    ...format.names.flatMap((name) => [
      { name: `photo.${name}`, type: '' },
      { name: `PHOTO.${name.toUpperCase()}`, type: 'application/octet-stream' },
      { name: `photo.${name}`, type: ZIP_TYPES[0] },
    ]),
    { name: 'photo', type: format.mime },
    { name: 'photo.heic', type: format.mime },
    { name: 'archive.zip', type: format.mime },
  ]),
  ...ZIP_EXTENSIONS.map((ext) => ({ name: `archive.${ext}`, type: '' })),
  ...ZIP_TYPES.map((type) => ({ name: 'archive', type })),
  { name: 'photo.gif', type: 'image/gif' },
  { name: 'notes.txt', type: 'text/plain' },
  { name: 'jpg', type: '' },
  { name: 'photo.jpg.txt', type: '' },
  { name: 'photo.jpgx', type: '' },
];

for (const [label, pagePath] of [
  ['Add gallery', () => PATHS.newGallery],
  ['gallery edit', (galleryId) => PATH_TO.gallery(galleryId)],
]) {
  test(`${label} page: the upload form carries the format rules of media/image-types.js`, async () => {
    const session = await app.signedIn();
    const galleryId = app.context.galleriesService.create(session.user);
    const { res, html } = await app.get(session, pagePath(galleryId));
    assert.equal(res.status, 200);
    const attrs = uploadFormAttrs(html);
    assert.equal(attrs['data-image-exts'], IMAGE_FORMATS.flatMap((f) => f.names).join(','));
    assert.equal(attrs['data-image-types'], IMAGE_FORMATS.map((f) => f.mime).join(','));
    assert.equal(attrs['data-zip-exts'], ZIP_EXTENSIONS.join(','));
    assert.equal(attrs['data-zip-types'], ZIP_TYPES.join(','));
    assert.equal(attrs['data-unsupported'], UNSUPPORTED_UPLOAD_MESSAGE);
    const accepts = [...html.matchAll(/<input[^>]*type="file"[^>]*accept="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(accepts, [UPLOAD_ACCEPT, UPLOAD_ACCEPT], 'both file inputs accept the table formats');
  });
}

test('the browser classifier, fed the rendered attributes, agrees with the server on every case', async () => {
  const session = await app.signedIn();
  const { html } = await app.get(session, PATHS.newGallery);
  const rules = browserRules()(datasetOf(uploadFormAttrs(html)));
  for (const file of CASES) {
    assert.equal(rules.kindOf(file), uploadKind(file.name, file.type), `${file.name} (${file.type || 'no type'})`);
  }
  assert.deepEqual(
    [...rules.imageTypes],
    IMAGE_FORMATS.map((f) => f.mime),
  );
  assert.equal(rules.unsupported, UNSUPPORTED_UPLOAD_MESSAGE);
});

test('the browser classifier refuses everything when the rules are missing (the server still validates)', () => {
  const rules = browserRules()({});
  for (const file of CASES) assert.equal(rules.kindOf(file), null, file.name);
});
