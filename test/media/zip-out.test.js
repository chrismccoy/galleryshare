import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { streamGalleryZip } from '../../media/zip-out.js';
import { zipEntryName } from '../../domain/gallery.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { entriesOf } from '../helpers/zip.js';
import { recordingLogger } from '../helpers/logger.js';
import { collectingResponse, failingStream, pendingStream, slowStream } from '../helpers/streams.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

const IMAGES = [
  { id: 7, public_name: 'aaaaaaaaaa', ext: 'jpg' },
  { id: 3, public_name: 'bbbbbbbbbb', ext: 'png' },
];

const storeOf = (files) => ({
  stream: ({ imageId }) => {
    if (!(imageId in files))
      return fs.createReadStream(path.join(os.tmpdir(), `zip-out-missing-${process.pid}-${imageId}`));
    return files[imageId] instanceof Error ? failingStream(files[imageId]) : Readable.from([files[imageId]]);
  },
});

function run(res, overrides) {
  return streamGalleryZip(res, {
    images: IMAGES,
    galleryId: 1,
    entryName: zipEntryName,
    now: () => NOW,
    logger: recordingLogger().logger,
    ...overrides,
  });
}

function startCounter() {
  let started = 0;
  return {
    onStart: () => {
      started += 1;
    },
    count: () => started,
  };
}

test('streamGalleryZip writes stored entries in order, named by position, dated now', async () => {
  const res = collectingResponse();
  const starts = startCounter();
  await run(res, {
    mediaStore: storeOf({ 7: Buffer.from('first'), 3: Buffer.from('second') }),
    onStart: starts.onStart,
  });
  assert.equal(starts.count(), 1);
  const entries = await entriesOf(Buffer.concat(res.chunks));
  assert.deepEqual(
    entries.map((e) => [e.name, e.method, e.data.toString()]),
    [
      ['aaaaaaaaaa-001.jpg', 0, 'first'],
      ['bbbbbbbbbb-002.png', 0, 'second'],
    ],
  );
  for (const e of entries) {
    const d = e.date;
    assert.deepEqual(
      [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()],
      [2026, 9, 30, 12, 0],
      'dated now',
    );
  }
});

test('a missing first file rejects before anything is written and onStart is not called', async () => {
  const res = collectingResponse();
  const starts = startCounter();
  await assert.rejects(run(res, { mediaStore: storeOf({ 3: Buffer.from('x') }), onStart: starts.onStart }), {
    code: 'ENOENT',
  });
  assert.equal(starts.count(), 0);
  assert.equal(res.chunks.length, 0);
  assert.equal(res.destroyed, false);
});

test('an error after the response started is logged and destroys the response', async () => {
  const res = collectingResponse();
  const { logger, warn, error } = recordingLogger();
  await run(res, { mediaStore: storeOf({ 7: Buffer.from('first'), 3: new Error('disk gone') }), logger });
  assert.equal(res.destroyed, true);
  assert.equal(warn.length, 1);
  assert.equal(error.length, 0);
});

test('a missing later file (ENOENT on its stream) is logged and destroys the response', async () => {
  const res = collectingResponse();
  const { logger, warn } = recordingLogger();
  await run(res, { mediaStore: storeOf({ 7: Buffer.from('first') }), logger });
  assert.equal(res.destroyed, true);
  assert.equal(warn.length, 1);
  const [message, fields] = warn[0];
  assert.equal(message, 'zip download failed');
  assert.equal(fields.galleryId, 1);
  assert.equal(fields.code, 'ENOENT');
  assert.match(fields.error, /no such file/);
});

test('a client that leaves while the first file opens: no start, file destroyed, no hang', async () => {
  const res = collectingResponse();
  const slow = pendingStream();
  slow.pending = true;
  const starts = startCounter();
  const done = run(res, {
    mediaStore: {
      stream: () => slow,
    },
    onStart: starts.onStart,
  });
  res.destroy();
  await done;
  assert.equal(starts.count(), 0);
  assert.equal(slow.destroyed, true);
});

test('entries are named by the injected entryName, and the store gets each image as one reference', async () => {
  const res = collectingResponse();
  const opened = [];
  await run(res, {
    mediaStore: {
      stream: (image, size) => {
        opened.push([image, size]);
        return Readable.from([Buffer.from(String(image.imageId))]);
      },
    },
    entryName: (_image, position) => `photo-${position}.bin`,
  });
  const entries = await entriesOf(Buffer.concat(res.chunks));
  assert.deepEqual(
    entries.map((e) => e.name),
    ['photo-1.bin', 'photo-2.bin'],
  );
  assert.deepEqual(opened, [
    [{ galleryId: 1, imageId: 7, ext: 'jpg' }, 'orig'],
    [{ galleryId: 1, imageId: 3, ext: 'png' }, 'orig'],
  ]);
});

test('a client that leaves mid-download: the file is closed, nothing is logged, no hang', async () => {
  const res = collectingResponse();
  const { logger, warn } = recordingLogger();
  const slow = slowStream();
  await run(res, {
    mediaStore: {
      stream: () => slow,
    },
    logger,
    images: [IMAGES[0]],
    onStart: () => setTimeout(() => res.destroy(), 10),
  });
  assert.equal(slow.destroyed, true);
  assert.equal(warn.length, 0);
});
