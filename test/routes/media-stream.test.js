import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { sendWebp } from '../../routes/view/media-stream.js';
import { recordingLogger } from '../helpers/logger.js';

let root;
let server;
let url;
const log = recordingLogger();

let open;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-media-stream-'));
  fs.writeFileSync(path.join(root, 'ok.webp'), 'RIFF....WEBP');
  const app = express();
  app.get('/img', (req, res) =>
    sendWebp(res, {
      open: () => open(),
      cacheControl: 'private, max-age=60',
      missing: () => res.status(404).type('text/plain').send('gone'),
      logger: log.logger,
      label: 'test stream failed',
      meta: { imageId: 7 },
    }),
  );
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  url = `http://127.0.0.1:${server.address().port}/img`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sendWebp streams the file with the WebP type and the given cache header', async () => {
  open = () => fs.createReadStream(path.join(root, 'ok.webp'));
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=60');
  assert.equal(await res.text(), 'RIFF....WEBP');
});

test('sendWebp sends the caller 404 for a missing file (ENOENT on the stream), without logging', async () => {
  log.warn.length = 0;
  open = () => fs.createReadStream(path.join(root, 'missing.webp'));
  const res = await fetch(url);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), null, 'no image cache header on a 404');
  assert.equal(await res.text(), 'gone');
  assert.deepEqual(log.warn, []);
});

test('sendWebp logs a read error other than ENOENT and still answers 404', async () => {
  log.warn.length = 0;
  open = () => {
    const stream = new Readable({
      read() {},
    });
    process.nextTick(() => stream.destroy(Object.assign(new Error('denied'), { code: 'EACCES' })));
    return stream;
  };
  const res = await fetch(url);
  assert.equal(res.status, 404);
  assert.deepEqual(log.warn, [['test stream failed', { imageId: 7, error: 'EACCES' }]]);
});

test('sendWebp rethrows any other error from opening the stream', async () => {
  open = () => {
    throw new TypeError('Invalid image extension');
  };
  const res = await fetch(url);
  assert.equal(res.status, 500);
});
