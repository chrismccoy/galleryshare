import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImage } from '../../media/image.js';
import { dhash } from '../../media/phash.js';
import { stripMetadata } from '../../media/strip-metadata/index.js';
import { UnreadableImageError } from '../../lib/errors.js';
import { GIF_BYTES, jpegWithGps, makeJpeg, makePng, makeWebp } from '../helpers/images.js';

test('fixture really carries GPS and orientation', async () => {
  const input = await makeJpeg({ width: 400, height: 300, orientation: 6, gps: true });
  const meta = await sharp(input).metadata();
  assert.ok(meta.exif, 'input has exif');
  assert.ok(input.includes(Buffer.from('Exif')), 'input has Exif segment');
  assert.equal(meta.orientation, 6);
  assert.ok(meta.exif.includes(Buffer.from([0x25, 0x88])) || meta.exif.includes(Buffer.from([0x88, 0x25])));
});

test('processImage returns stripped original, 2000px web and 600px thumb as WebP', async () => {
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();
  const r = await processImage(big);
  assert.equal(r.mime, 'image/jpeg');
  assert.equal(r.ext, 'jpg');
  assert.equal((await sharp(r.web).metadata()).format, 'webp');
  assert.equal(Math.max(r.width, r.height), 2000);
  const t = await sharp(r.thumb).metadata();
  assert.equal(t.format, 'webp');
  assert.equal(Math.max(t.width, t.height), 600);
});

test('processImage returns the perceptual hash of the upload', async () => {
  const input = await makeJpeg({ width: 400, height: 300 });
  const r = await processImage(input);
  assert.equal(r.phash, await dhash(input));
});

test('original is the metadata-stripped upload', async () => {
  const input = await jpegWithGps({ orientation: 6 });
  const r = await processImage(input);
  assert.ok(!r.original.includes(Buffer.from('TestCam')));
  assert.ok(!r.original.includes(Buffer.from('secret comment')));
  assert.deepEqual(r.original, stripMetadata(input, 'image/jpeg'));
});

test('web copy of an orientation-6 photo is upright and has no EXIF', async () => {
  const r = await processImage(await jpegWithGps({ orientation: 6 }));
  const m = await sharp(r.web).metadata();
  assert.equal(m.exif, undefined);
  assert.ok(m.height > m.width); 
  assert.equal(r.height, m.height);
  assert.equal(r.width, m.width);
  const t = await sharp(r.thumb).metadata();
  assert.equal(t.exif, undefined);
  assert.ok(t.height > t.width);
});

test('does not enlarge a small PNG', async () => {
  const r = await processImage(await makePng({ width: 800, height: 600 }));
  assert.equal(r.ext, 'png');
  assert.equal(r.width, 800);
  assert.equal(r.height, 600);
});

test('webp input keeps ext webp', async () => {
  const r = await processImage(await makeWebp());
  assert.equal(r.ext, 'webp');
  assert.equal(r.mime, 'image/webp');
});

test('accepts a 60 MP image, rejects a 120 MP image', async () => {
  const make = (width, height) =>
    sharp({ create: { width, height, channels: 3, background: '#445566' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  const ok = await processImage(await make(9000, 6700));
  assert.equal(Math.max(ok.width, ok.height), 2000);
  await assert.rejects(processImage(await make(12000, 10000)), UnreadableImageError);
});

test('rejects a text file', async () => {
  await assert.rejects(processImage(Buffer.from('hello world!')), UnreadableImageError);
});

test('GIF rejects as unsupported type', async () => {
  await assert.rejects(processImage(GIF_BYTES), (err) => {
    assert.ok(err instanceof UnreadableImageError);
    assert.equal(err.message, 'Use a JPEG, PNG or WebP photo.');
    return true;
  });
});

test('truncated JPEG rejects with generic read error', async () => {
  const full = await makeJpeg({ width: 600, height: 400, quality: 95 });
  const cut = full.subarray(0, Math.floor(full.length / 2));
  await assert.rejects(processImage(cut), (err) => {
    assert.ok(err instanceof UnreadableImageError);
    assert.equal(err.message, 'This image could not be read.');
    return true;
  });
});
