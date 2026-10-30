import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_MB } from '../../lib/size.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import { NOT_AN_IMAGE_MESSAGE, ZIP_LIMIT, inspectZip, zipEntryLabel, zipImages } from '../../media/zip-intake.js';
import { SNIFF_BYTES } from '../../media/image-types.js';
import { LimitExceededError, UnreadableImageError } from '../../lib/errors.js';
import { makeJpeg, makePng, makeWebp } from '../helpers/images.js';
import { forgeDeclaredSize, writeEmptyEntriesZip, writeZip } from '../helpers/zip.js';
const LIMITS = {
  maxEntryBytes: 25 * BYTES_PER_MB,
  maxTotalBytes: 500 * BYTES_PER_MB,
  maxEntries: 500,
  maxExamined: 5000,
  maxRejected: 100,
};

let dir;
let jpeg;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-zip-'));
  jpeg = await makeJpeg();
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let zipSeq = 0;
const zipPath = () => path.join(dir, `t${++zipSeq}.zip`);

async function collect(file, names) {
  const out = [];
  for await (const item of zipImages(file, names)) out.push(item);
  return out;
}

test('inspectZip lists images in nested folders and skips __MACOSX, dotfiles and non-images', async () => {
  const file = await writeZip(zipPath(), [
    { name: 'top.JPG', data: jpeg },
    { name: 'trip/' },
    { name: 'trip/day1/beach.png', data: await makePng({ width: 4, height: 4 }) },
    { name: 'trip/day1/sea.webp', data: await makeWebp() },
    { name: 'trip/notes.txt', data: 'hello' },
    { name: 'trip/.hidden.jpg', data: jpeg },
    { name: '.DS_Store', data: 'x' },
    { name: '__MACOSX/trip/._beach.png', data: 'resource fork' },
    { name: 'trip/raw.gif', data: 'GIF89a' },
    { name: 'trip/photo.jpeg', data: jpeg },
  ]);
  const { entries } = await inspectZip(file, LIMITS);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['top.JPG', 'trip/day1/beach.png', 'trip/day1/sea.webp', 'trip/photo.jpeg'],
  );
  assert.equal(entries[0].size, jpeg.length);
});

test('inspectZip of a ZIP with no images returns no entries (the caller decides)', async () => {
  const file = await writeZip(zipPath(), [
    { name: 'readme.txt', data: 'x' },
    { name: '__MACOSX/._a.jpg', data: 'x' },
    { name: 'pics/' },
    { name: '.a.jpg', data: jpeg },
  ]);
  assert.deepEqual(await inspectZip(file, { ...LIMITS, sniff: true }), { entries: [], rejected: [] });
});

test('inspectZip rejects an entry larger than maxEntryBytes', async () => {
  const big = Buffer.alloc(2 * BYTES_PER_MB + 10, 7);
  const file = await writeZip(zipPath(), [
    { name: 'a.jpg', data: jpeg },
    { name: 'folder/huge.png', data: big },
  ]);
  await assert.rejects(inspectZip(file, { ...LIMITS, maxEntryBytes: 2 * BYTES_PER_MB }), (error) => {
    assert.ok(error instanceof LimitExceededError);
    assert.equal(error.publicStatus, 413);
    assert.equal(error.publicMessage, 'huge.png is larger than 2 MB.');
    return true;
  });
});

test('inspectZip rejects a total uncompressed size over maxTotalBytes and a count over maxEntries', async () => {
  const chunk = Buffer.alloc(BYTES_PER_MB, 1);
  const file = await writeZip(zipPath(), [
    { name: 'a.jpg', data: chunk },
    { name: 'b.jpg', data: chunk },
    { name: 'c.jpg', data: chunk },
  ]);
  await assert.rejects(inspectZip(file, { ...LIMITS, maxTotalBytes: 2 * BYTES_PER_MB }), LimitExceededError);
  await assert.rejects(inspectZip(file, { ...LIMITS, maxEntries: 2 }), (error) => {
    assert.ok(error instanceof LimitExceededError);
    assert.equal(error.publicMessage, 'This ZIP has more than 2 images; at most 2 can be added.');
    return true;
  });
  assert.equal(
    (await inspectZip(file, { ...LIMITS, maxEntries: 3, maxTotalBytes: 3 * BYTES_PER_MB })).entries.length,
    3,
  );
});

test('inspectZip with sniff keeps real images and rejects image-named entries that are not images', async () => {
  const png = await makePng({ width: 4, height: 4 });
  const file = await writeZip(zipPath(), [
    { name: 'a.jpg', data: jpeg },
    { name: 'docs/fake.jpg', data: 'just some text, renamed' },
    { name: 'tiny.png', data: 'abc' },
    { name: 'b/c.png', data: png },
    { name: 'notes.txt', data: 'ignored by name' },
  ]);
  const { entries, rejected } = await inspectZip(file, { ...LIMITS, sniff: true });
  assert.deepEqual(
    entries.map((e) => e.name),
    ['a.jpg', 'b/c.png'],
  );
  assert.deepEqual(rejected, [
    { name: 'docs/fake.jpg', reason: NOT_AN_IMAGE_MESSAGE },
    { name: 'tiny.png', reason: NOT_AN_IMAGE_MESSAGE },
  ]);
  assert.equal(NOT_AN_IMAGE_MESSAGE, 'Not a JPEG, PNG or WebP image.');
  const unsniffed = await inspectZip(file, LIMITS);
  assert.equal(unsniffed.entries.length, 4, 'without sniff only names count');
  assert.deepEqual(unsniffed.rejected, []);
});

test('inspectZip with sniff counts only sniffed images against maxEntries', async () => {
  const file = await writeZip(zipPath(), [
    { name: 'a.jpg', data: jpeg },
    { name: 'b.jpg', data: 'fake' },
    { name: 'c.jpg', data: 'fake' },
    { name: 'd.jpg', data: jpeg },
  ]);
  const { entries, rejected } = await inspectZip(file, { ...LIMITS, maxEntries: 2, sniff: true });
  assert.equal(entries.length, 2);
  assert.equal(rejected.length, 2);
});

test('inspectZip stops the directory walk past maxExamined entries of any kind', async (t) => {
  const file = writeEmptyEntriesZip(zipPath(), [...Array.from({ length: 30 }, (_, i) => `docs/${i}.txt`), 'late.jpg']);
  const walked = t.mock.method(yauzl.ZipFile.prototype, 'readEntry');
  await assert.rejects(inspectZip(file, { ...LIMITS, maxExamined: 20, name: 'many.zip' }), (error) => {
    assert.ok(error instanceof LimitExceededError);
    assert.equal(error.code, ZIP_LIMIT.files);
    assert.equal(error.publicMessage, 'many.zip has too many files (more than 20).');
    return true;
  });
  assert.ok(walked.mock.callCount() <= 21, `the walk stops at the cap: ${walked.mock.callCount()} of 31 entries read`);
  walked.mock.restore();
  assert.equal((await inspectZip(file, { ...LIMITS, maxExamined: 31 })).entries.length, 1);
});

test('inspectZip with sniff refuses once more than maxRejected entries fail it', async () => {
  const file = writeEmptyEntriesZip(
    zipPath(),
    Array.from({ length: 5 }, (_, i) => `fake${i}.jpg`),
  );
  await assert.rejects(inspectZip(file, { ...LIMITS, sniff: true, maxRejected: 4, name: 'f.zip' }), (error) => {
    assert.equal(error.code, ZIP_LIMIT.notImages);
    assert.equal(error.publicMessage, 'f.zip has too many files that are not real images.');
    return true;
  });
  const { rejected } = await inspectZip(file, { ...LIMITS, sniff: true, maxRejected: 5 });
  assert.equal(rejected.length, 5);
});

test('inspectZip with sniff stops sniffing as soon as the images pass maxEntries', async (t) => {
  const file = await writeZip(
    zipPath(),
    Array.from({ length: 40 }, (_, i) => ({ name: `p/${i}.jpg`, data: jpeg })),
  );
  const opened = t.mock.method(yauzl.ZipFile.prototype, 'openReadStream');
  await assert.rejects(inspectZip(file, { ...LIMITS, maxEntries: 3, sniff: true }), (error) => {
    assert.equal(error.code, ZIP_LIMIT.images);
    return true;
  });
  assert.equal(opened.mock.callCount(), 4, 'only the first maxEntries + 1 entries are sniffed');
});

test('the sniff reads only the first chunk of an entry, however large it is', async (t) => {
  const big = Buffer.alloc(64 * BYTES_PER_MB, 0);
  jpeg.copy(big, 0, 0, SNIFF_BYTES);
  const file = await writeZip(zipPath(), [{ name: 'huge.jpg', data: big }]);
  const openReadStream = yauzl.ZipFile.prototype.openReadStream;
  let inflated = 0;
  let ended = false;
  const streams = [];
  const opened = t.mock.method(yauzl.ZipFile.prototype, 'openReadStream', function (entry, ...rest) {
    const callback = rest.pop();
    return openReadStream.call(this, entry, ...rest, (error, stream) => {
      stream?.on('data', (chunk) => (inflated += chunk.length));
      stream?.on('end', () => (ended = true));
      if (stream) streams.push(stream);
      callback(error, stream);
    });
  });
  const { entries } = await inspectZip(file, { ...LIMITS, maxEntryBytes: 100 * BYTES_PER_MB, sniff: true });
  assert.equal(entries.length, 1);
  assert.equal(opened.mock.callCount(), 1, 'one entry stream for one entry');
  assert.ok(inflated > 0 && inflated <= 256 * 1024, `inflated ${inflated} bytes`);
  assert.equal(ended, false, 'the stream is dropped after the first chunk, never read to its end');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].destroyed, true, 'the sniff destroys the entry stream once it has its bytes');
});

test('inspectZip refuses to run without a finite value for every size and count limit', async () => {
  const file = await writeZip(zipPath(), [{ name: 'a.jpg', data: jpeg }]);
  for (const key of ['maxEntryBytes', 'maxTotalBytes', 'maxEntries', 'maxExamined', 'maxRejected']) {
    for (const value of [undefined, Infinity, Number.NaN, '5']) {
      await assert.rejects(inspectZip(file, { ...LIMITS, [key]: value }), (error) => {
        assert.ok(error instanceof TypeError, `${key}=${String(value)} is refused`);
        assert.match(error.message, new RegExp(key));
        return true;
      });
    }
  }
  assert.equal((await inspectZip(file, LIMITS)).entries.length, 1);
});

test('inspectZip rejects a corrupt file with "This ZIP file could not be read."', async () => {
  const bogus = path.join(dir, 'bogus.zip');
  fs.writeFileSync(bogus, Buffer.from('this is not a zip archive at all, just text'));
  const truncated = path.join(dir, 'truncated.zip');
  const good = fs.readFileSync(await writeZip(zipPath(), [{ name: 'a.jpg', data: jpeg }]));
  fs.writeFileSync(truncated, good.subarray(0, good.length - 30));
  for (const file of [bogus, truncated]) {
    await assert.rejects(inspectZip(file, LIMITS), (error) => {
      assert.ok(error instanceof UnreadableImageError);
      assert.equal(error.publicMessage, 'This ZIP file could not be read.');
      return true;
    });
  }
});

test('zipImages yields only the listed entries, in the order given, as buffers', async () => {
  const png = await makePng({ width: 4, height: 4 });
  const file = await writeZip(zipPath(), [
    { name: 'x/a.jpg', data: jpeg },
    { name: 'x/b.png', data: png },
    { name: 'x/c.jpg', data: jpeg },
  ]);
  const items = await collect(file, new Set(['x/c.jpg', 'x/b.png']));
  assert.deepEqual(
    items.map((i) => i.name),
    ['x/c.jpg', 'x/b.png'],
  );
  assert.ok(items[0].buffer.equals(jpeg));
  assert.ok(items[1].buffer.equals(png));
});

test('zipImages stops an entry whose inflated data exceeds its declared size (zip bomb)', async () => {
  const file = await writeZip(zipPath(), [
    { name: 'bomb.jpg', data: Buffer.alloc(4 * BYTES_PER_MB, 0) },
    { name: 'ok.jpg', data: jpeg },
  ]);
  forgeDeclaredSize(file, 'bomb.jpg', 1000);
  const { entries } = await inspectZip(file, { ...LIMITS, maxEntryBytes: BYTES_PER_MB });
  assert.deepEqual(
    entries.map((e) => [e.name, e.size]),
    [
      ['bomb.jpg', 1000],
      ['ok.jpg', jpeg.length],
    ],
  );
  const items = await collect(file, new Set(['bomb.jpg', 'ok.jpg']));
  assert.equal(items[0].name, 'bomb.jpg');
  assert.equal(items[0].buffer, undefined);
  assert.ok(items[0].error instanceof UnreadableImageError);
  assert.match(items[0].error.cause.message, /too many bytes in the stream/);
  assert.ok(items[1].buffer.equals(jpeg), 'later entries are still read');
});

test('zipEntryLabel names a ZIP entry by the ZIP and the entry base name', () => {
  assert.equal(zipEntryLabel('trip.zip', 'beach.jpg'), 'trip.zip/beach.jpg');
  assert.equal(zipEntryLabel('trip.zip', 'day 1/sub/beach.jpg'), 'trip.zip/beach.jpg');
});
