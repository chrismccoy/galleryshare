import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  IMAGE_SIZES,
  PUBLIC_IMAGE_SIZES,
  createMediaStore,
  isImageSize,
  isPublicImageSize,
} from '../../media/media-store.js';

async function withStore(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-store-'));
  try {
    await fn(createMediaStore(root), root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const files = () => ({ original: Buffer.from('orig-bytes'), web: Buffer.from('web'), thumb: Buffer.from('th') });

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

const ref = (galleryId, imageId, ext) => ({ galleryId, imageId, ext });

const streamError = (stream) => new Promise((resolve) => stream.once('error', resolve));

test('paths follow the layout', () =>
  withStore((store, root) => {
    assert.deepEqual(store.paths(ref(3, 7, 'jpg')), {
      orig: path.join(root, '3', 'orig', '7.jpg'),
      web: path.join(root, '3', 'web', '7.webp'),
      thumb: path.join(root, '3', 'thumb', '7.webp'),
    });
  }));

test('writes three files, reports sizes, streams, removes image then gallery', () =>
  withStore(async (store, root) => {
    const sizes = await store.write(ref(1, 2, 'jpg'), files());
    assert.deepEqual(sizes, { bytesOrig: 10, bytesWeb: 3, bytesThumb: 2 });
    assert.equal((await readAll(store.stream(ref(1, 2, 'jpg'), 'orig'))).toString(), 'orig-bytes');
    assert.equal((await readAll(store.stream(ref(1, 2, 'jpg'), 'web'))).toString(), 'web');
    assert.equal((await readAll(store.stream(ref(1, 2, 'jpg'), 'thumb'))).toString(), 'th');
    assert.deepEqual((await fs.readdir(path.join(root, '1', 'web'))).sort(), ['2.webp']);

    await store.write(ref(1, 3, 'png'), files());
    await store.removeImage(ref(1, 2, 'jpg'));
    await store.removeImage(ref(1, 2, 'jpg')); 
    assert.equal((await streamError(store.stream(ref(1, 2, 'jpg'), 'web'))).code, 'ENOENT');
    assert.equal((await readAll(store.stream(ref(1, 3, 'png'), 'web'))).toString(), 'web');

    await store.removeGallery(1);
    await store.removeGallery(1);
    await assert.rejects(fs.stat(path.join(root, '1')));
  }));

test('removeImage also deletes leftover .part files', () =>
  withStore(async (store) => {
    const target = store.paths(ref(1, 2, 'jpg'));
    await fs.mkdir(path.dirname(target.web), { recursive: true });
    await fs.writeFile(`${target.web}.part`, 'half');
    await store.removeImage(ref(1, 2, 'jpg'));
    await assert.rejects(fs.stat(`${target.web}.part`), { code: 'ENOENT' });
  }));

test('stream of a missing file reports ENOENT on the stream, not by throwing', () =>
  withStore(async (store) => {
    const stream = store.stream(ref(1, 1, 'jpg'), 'web');
    assert.equal((await streamError(stream)).code, 'ENOENT');
  }));

test('read gives a version whole; a missing file rejects with ENOENT', () =>
  withStore(async (store) => {
    const image = ref(1, 2, 'jpg');
    await store.write(image, files());
    assert.deepEqual(await store.read(image, 'web'), Buffer.from('web'));
    assert.deepEqual(await store.read(image, 'orig'), Buffer.from('orig-bytes'));
    await assert.rejects(store.read(ref(1, 3, 'jpg'), 'web'), { code: 'ENOENT' });
    assert.throws(() => store.read(image, 'huge'), TypeError);
  }));

test('refuses bad ids, ext and size', () =>
  withStore(async (store) => {
    assert.throws(() => store.paths(ref('../x', 1, 'jpg')), TypeError);
    assert.throws(() => store.paths(ref(1, '1/../2', 'jpg')), TypeError);
    assert.throws(() => store.paths(ref(0, 1, 'jpg')), TypeError);
    assert.throws(() => store.paths(ref(1.5, 1, 'jpg')), TypeError);
    assert.throws(() => store.paths(ref(1, 1, 'gif')), TypeError);
    assert.throws(() => store.stream(ref(1, 1, 'jpg'), 'huge'), TypeError);
    await assert.rejects(store.removeGallery('..'));
    await assert.rejects(store.removeImage(ref(1, '../2', 'jpg')));
  }));

test('the size sets: every stored version, and only web and thumb are public', () => {
  assert.deepEqual([...IMAGE_SIZES].sort(), ['orig', 'thumb', 'web']);
  assert.deepEqual([...PUBLIC_IMAGE_SIZES].sort(), ['thumb', 'web']);
  assert.ok(Object.isFrozen(IMAGE_SIZES) && Object.isFrozen(PUBLIC_IMAGE_SIZES), 'the lists cannot be widened');
  assert.equal(isPublicImageSize('orig'), false, 'originals are never public');
  assert.equal(isPublicImageSize('web'), true);
  assert.equal(isImageSize('orig'), true);
  assert.equal(isImageSize('huge'), false);
});
