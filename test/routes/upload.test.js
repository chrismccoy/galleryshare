import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_MB } from '../../lib/size.js';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { buildContext } from '../helpers/context.js';
import { silentLogger } from '../helpers/constants.js';
import { listen } from '../helpers/app-client.js';
import { tempDir } from '../helpers/temp.js';
import { multipart, setLimit as setContextLimit, tmpFiles as filesIn } from '../helpers/uploads.js';
import { errorHandler } from '../../routes/middleware/errors.js';
import { uploadFiles } from '../../routes/middleware/upload.js';
import { isTempName } from '../../lib/upload-temp.js';
import { fakeRequest, fakeResponse } from '../helpers/fake-response.js';
const TOKEN = 'test-csrf-token';

let harness;
beforeEach(async (t) => {
  const root = tempDir(t, 'gs-upload-');
  const tmp = path.join(root, 'tmp');
  const { context } = buildContext({ env: { TMP_UPLOAD_DIR: tmp, MEDIA_DIR: path.join(root, 'media') } });
  const seen = [];
  const app = express();
  app.use((req, _res, next) => {
    req.csrfToken = TOKEN;
    next();
  });
  const record = (req, res) => {
    const files = req.files ?? [];
    seen.push(files);
    res.json({ files: files.map((f) => ({ name: f.originalname, size: f.size, path: f.path })) });
  };
  app.post('/upload', ...uploadFiles(context.effectiveConfigService, tmp), record);
  app.use(errorHandler(silentLogger));
  const { url, close } = await listen(app);
  harness = { root, tmp, context, close, seen, url };
});
afterEach(() => harness.close());

const tmpFiles = () => filesIn(harness.tmp);

const setLimit = (name, value) => setContextLimit(harness.context, name, value);

function postMultipart(route, files, { field = 'files', csrfToken = TOKEN } = {}) {
  const body = multipart(files, { csrf: csrfToken, field });
  return fetch(`${harness.url}${route}`, { method: 'POST', body, headers: { accept: 'application/json' } });
}

function headersOnly(route, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${harness.url}${route}`, {
      method: 'POST',
      headers: { accept: 'application/json', ...headers },
    });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.flushHeaders();
  });
}

test('POST images and ZIP files within the limits stores them as temp files in tmpDir', async () => {
  const res = await postMultipart('/upload', [
    { name: 'a.jpg', data: Buffer.alloc(100, 1) },
    { name: 'pics.zip', data: Buffer.alloc(150, 3) },
    { name: 'b.jpg', data: Buffer.alloc(200, 2) },
    { name: 'more.ZIP', data: Buffer.alloc(50, 4) },
  ]);
  assert.equal(res.status, 200);
  const { files } = await res.json();
  assert.deepEqual(
    files.map((f) => [f.name, f.size]),
    [
      ['a.jpg', 100],
      ['pics.zip', 150],
      ['b.jpg', 200],
      ['more.ZIP', 50],
    ],
  );
  for (const f of files) {
    assert.equal(path.dirname(f.path), harness.tmp);
    assert.ok(isTempName(path.basename(f.path)), 'temp names are random and match what boot cleanup removes');
  }
});

test('a file that is neither an image nor a ZIP refuses the whole upload and stores nothing', async () => {
  const res = await postMultipart('/upload', [
    { name: 'a.jpg', data: Buffer.alloc(100, 1) },
    { name: 'notes.txt', data: Buffer.from('hello') },
    { name: 'b.zip', data: Buffer.alloc(100, 1) },
  ]);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Only JPEG, PNG, WebP images or ZIP files can be uploaded.' });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('an image over maxImageMb is refused even when ZIP files may be larger, and nothing is stored', async () => {
  setLimit('maxImageMb', 1);
  setLimit('maxZipUploadMb', 5);
  const res = await postMultipart('/upload', [
    { name: 'small.jpg', data: Buffer.alloc(1000, 1) },
    { name: 'big.jpg', data: Buffer.alloc(BYTES_PER_MB + 10, 2) },
  ]);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'big.jpg is larger than 1 MB.' });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('a ZIP over maxZipUploadMb is refused (by multer, or after it when images may be larger)', async () => {
  setLimit('maxZipUploadMb', 1);
  const viaMulter = await postMultipart('/upload', [
    { name: 'a.jpg', data: Buffer.alloc(100) },
    { name: 'pics.zip', data: Buffer.alloc(BYTES_PER_MB + 10) },
  ]);
  assert.equal(viaMulter.status, 413);
  assert.deepEqual(await viaMulter.json(), { error: 'The ZIP file pics.zip is larger than 1 MB.' });
  setLimit('maxImageMb', 3);
  const afterMulter = await postMultipart('/upload', [{ name: 'pics.zip', data: Buffer.alloc(2 * BYTES_PER_MB) }]);
  assert.equal(afterMulter.status, 413);
  assert.deepEqual(await afterMulter.json(), { error: 'The ZIP file pics.zip is larger than 1 MB.' });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('the sum of all files over maxUploadBatchMb is refused and nothing is stored', async () => {
  setLimit('maxUploadBatchMb', 2);
  setLimit('maxZipUploadMb', 5);
  const res = await postMultipart('/upload', [
    { name: 'a.jpg', data: Buffer.alloc(BYTES_PER_MB) },
    { name: 'pics.zip', data: Buffer.alloc(BYTES_PER_MB) },
    { name: 'more.zip', data: Buffer.alloc(BYTES_PER_MB) },
  ]);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'This upload is 3 MB; uploads are limited to 2 MB.' });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('POST with more files than a gallery can hold is rejected and stores nothing', async () => {
  setLimit('maxImagesPerGallery', 2);
  const res = await postMultipart(
    '/upload',
    ['a.jpg', 'b.zip', 'c.jpg'].map((name) => ({ name, data: Buffer.alloc(10) })),
  );
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), {
    error: 'This upload has more than 2 files; at most 2 files can be uploaded at once.',
  });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('Content-Length over the larger of the batch and ZIP limits (plus 1 MB) is rejected before reading the body', async () => {
  setLimit('maxUploadBatchMb', 5);
  setLimit('maxZipUploadMb', 3);
  const headers = { 'content-type': 'multipart/form-data; boundary=x' };
  const over = await headersOnly('/upload', { ...headers, 'content-length': String(6 * BYTES_PER_MB + 1) });
  assert.equal(over.status, 413);
  assert.deepEqual(over.body, { error: 'This upload is 6 MB; uploads are limited to 5 MB.' });

  setLimit('maxZipUploadMb', 8);
  const zipBound = await headersOnly('/upload', { ...headers, 'content-length': String(9 * BYTES_PER_MB + 1) });
  assert.equal(zipBound.status, 413);
  assert.deepEqual(zipBound.body, { error: 'This upload is 9 MB; uploads are limited to 8 MB.' });
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('POST without a Content-Length is rejected with 411', async () => {
  const res = await headersOnly('/upload', {
    'content-type': 'multipart/form-data; boundary=x',
    'transfer-encoding': 'chunked',
  });
  assert.equal(res.status, 411);
  assert.equal(harness.seen.length, 0);
});

test('a Content-Length that is not a number is refused with 400 before the body is read', () => {
  const [checkLength] = uploadFiles(harness.context.effectiveConfigService, harness.tmp);
  for (const header of ['abc', '-5', 'Infinity']) {
    const { res, out } = fakeResponse();
    let passed;
    checkLength(fakeRequest({ method: 'POST', headers: { 'content-length': header } }), res, (error) => {
      passed = error;
    });
    assert.equal(passed?.publicStatus, 400, header);
    assert.equal(passed.publicMessage, 'The upload could not be read. Try again.', header);
    assert.equal(out.headers.Connection, 'close', header);
  }
});

test('the parser and the size check refuse to run when the Content-Length step did not run first', () => {
  const [, parse, , checkSizes] = uploadFiles(harness.context.effectiveConfigService, harness.tmp);
  const { res } = fakeResponse();
  for (const step of [parse, checkSizes]) {
    assert.throws(
      () => step(fakeRequest({ method: 'POST' }), res, () => assert.fail('must not continue')),
      /checkLength must run first/,
    );
  }
});

test('a limit changed in Settings applies to the next upload without restart', async () => {
  const file = [{ name: 'photo.jpg', data: Buffer.alloc(2 * BYTES_PER_MB, 3) }];
  const first = await postMultipart('/upload', file);
  assert.equal(first.status, 200);
  setLimit('maxImageMb', 1);
  const second = await postMultipart('/upload', file);
  assert.equal(second.status, 413);
  assert.deepEqual(await second.json(), { error: 'photo.jpg is larger than 1 MB.' });
  setLimit('maxZipUploadMb', 1);
  const zip = await postMultipart('/upload', [{ name: 'a.zip', data: Buffer.alloc(BYTES_PER_MB + 10) }]);
  assert.equal(zip.status, 413);
  assert.deepEqual(await zip.json(), { error: 'The ZIP file a.zip is larger than 1 MB.' });
});

test('files sent under another field name are not read', async () => {
  const res = await postMultipart('/upload', [{ name: 'a.jpg', data: Buffer.alloc(50) }], { field: 'images' });
  assert.equal(res.status, 400);
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});

test('a multipart upload with a bad CSRF token is refused and its temp files are deleted', async () => {
  const res = await postMultipart('/upload', [{ name: 'a.jpg', data: Buffer.alloc(100) }], { csrfToken: 'wrong' });
  assert.equal(res.status, 403);
  assert.equal(harness.seen.length, 0);
  assert.deepEqual(tmpFiles(), []);
});
