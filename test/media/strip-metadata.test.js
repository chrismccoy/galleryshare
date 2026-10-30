import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { STRIPPERS, readOrientation, stripMetadata } from '../../media/strip-metadata/index.js';
import { stripJpeg } from '../../media/strip-metadata/jpeg.js';
import { stripPng } from '../../media/strip-metadata/png.js';
import { stripWebp } from '../../media/strip-metadata/webp.js';
import { IMAGE_TYPES } from '../../media/image-types.js';
import { UnreadableImageError } from '../../lib/errors.js';
import { jpegWithGps, pngChunk, pngWithText, webpWithExif } from '../helpers/images.js';

const CASES = [
  ['JPEG', () => jpegWithGps(), 'image/jpeg'],
  ['progressive JPEG', () => jpegWithGps({ progressive: true }), 'image/jpeg'],
  ['PNG', () => pngWithText(), 'image/png'],
  ['WebP', () => webpWithExif(), 'image/webp'],
];

const GPS_IFD_TAG = [Buffer.from([0x88, 0x25]), Buffer.from([0x25, 0x88])];
const hasGpsTag = (exif) => GPS_IFD_TAG.some((tag) => exif.includes(tag));

for (const [name, build, mime] of CASES) {
  test(`${name}: fixture really carries GPS, camera, XMP/text and ICC`, async () => {
    const src = await build();
    const meta = await sharp(src).metadata();
    assert.ok(meta.exif && hasGpsTag(meta.exif));
    assert.ok(meta.icc);
    assert.ok(src.includes(Buffer.from('TestCam')));
    assert.ok(src.includes(Buffer.from('secret')));
  });

  test(`${name}: GPS/camera metadata gone`, async () => {
    const src = await build();
    const out = stripMetadata(src, mime);
    const meta = await sharp(out).metadata();
    assert.equal(meta.exif === undefined || !meta.exif.includes('GPS'), true);
    assert.ok(meta.exif === undefined || !hasGpsTag(meta.exif));
    assert.equal(meta.xmp, undefined);
    assert.ok(!out.includes(Buffer.from('TestCam')));
    assert.ok(!out.includes(Buffer.from('secret')));
  });

  test(`${name}: pixels identical`, async () => {
    const src = await build();
    const a = await sharp(src).raw().toBuffer();
    const b = await sharp(stripMetadata(src, mime)).raw().toBuffer();
    assert.ok(a.equals(b));
  });

  test(`${name}: ICC profile kept`, async () => {
    const src = await build();
    const before = (await sharp(src).metadata()).icc;
    const after = (await sharp(stripMetadata(src, mime)).metadata()).icc;
    assert.ok(after);
    assert.ok(after.equals(before));
  });

  test(`${name}: stripping twice changes nothing more`, async () => {
    const once = stripMetadata(await build(), mime);
    assert.ok(stripMetadata(once, mime).equals(once));
  });
}

test('JPEG keeps orientation 6 and nothing else in EXIF', async () => {
  const out = stripMetadata(await jpegWithGps({ orientation: 6 }), 'image/jpeg');
  assert.equal(readOrientation(out), 6);
  assert.equal((await sharp(out).metadata()).orientation, 6);
  const app1 = out.indexOf(Buffer.from([0xff, 0xe1]));
  assert.ok(app1 > 0);
  assert.equal(out.readUInt16BE(app1 + 2), 34, 'minimal APP1 is 34 bytes long');
  assert.equal(out.indexOf(Buffer.from('Exif\0\0')), out.lastIndexOf(Buffer.from('Exif\0\0')));
});

test('JPEG progressive keeps orientation too', async () => {
  const out = stripMetadata(await jpegWithGps({ orientation: 8, progressive: true }), 'image/jpeg');
  assert.equal((await sharp(out).metadata()).orientation, 8);
  assert.equal((await sharp(out).metadata()).isProgressive, true);
});

test('JPEG with orientation 1 gets no EXIF at all', async () => {
  const out = stripMetadata(await jpegWithGps({ orientation: 1 }), 'image/jpeg');
  assert.equal(readOrientation(out), 1);
  assert.equal((await sharp(out).metadata()).exif, undefined);
  assert.ok(!out.includes(Buffer.from([0xff, 0xe1])));
});

test('JPEG keeps JFIF APP0 first, minimal APP1 right after it', async () => {
  const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
    .withMetadata({ orientation: 3 })
    .jpeg()
    .toBuffer();
  const jfif = seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const src = Buffer.concat([base.subarray(0, 2), jfif, base.subarray(2)]);
  const out = stripMetadata(src, 'image/jpeg');
  assert.ok((await sharp(out).raw().toBuffer()).equals(await sharp(src).raw().toBuffer()));
  assert.deepEqual([...out.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(out.subarray(6, 11).toString('latin1'), 'JFIF\0');
  const afterApp0 = 4 + out.readUInt16BE(4);
  assert.deepEqual([...out.subarray(afterApp0, afterApp0 + 2)], [0xff, 0xe1]);
  assert.equal(readOrientation(out), 3);
});

test('JPEG drops trailing data after EOI (motion photo payload)', async () => {
  const src = Buffer.concat([await jpegWithGps({}), Buffer.from('\xff\xd8 hidden GPS payload')]);
  assert.ok(!stripMetadata(src, 'image/jpeg').includes(Buffer.from('hidden')));
});

test('JPEG drops a second embedded JPEG with its own EXIF after EOI', async () => {
  const main = await jpegWithGps({ orientation: 1 });
  const out = stripMetadata(Buffer.concat([main, await jpegWithGps()]), 'image/jpeg');
  assert.ok(!out.includes(Buffer.from('TestCam')));
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.equal(out.indexOf(Buffer.from([0xff, 0xd9])), out.length - 2);
});

function seg(marker, payload) {
  const b = Buffer.alloc(4 + payload.length);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(payload.length + 2, 2);
  Buffer.from(payload).copy(b, 4);
  return b;
}
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

test('JPEG walker: fill bytes, TEM, DRI, RST and 0xFF00 stuffing handled', () => {
  const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
  const dri = seg(0xdd, [0x00, 0x04]);
  const sof = seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
  const dht = seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  const entropy = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00, 0xff, 0xd7, 0x78]);
  const src = Buffer.concat([
    SOI,
    Buffer.from([0xff, 0xff, 0xff]), 
    seg(0xe1, Buffer.from('Exif\0\0junk')),
    Buffer.from([0xff, 0x01]), 
    seg(0xfe, Buffer.from('secret')),
    dqt,
    dri,
    sof,
    dht,
    sos,
    entropy,
    Buffer.from([0xff, 0xff]), 
    EOI,
    Buffer.from('trailing'),
  ]);
  const out = stripMetadata(src, 'image/jpeg');
  assert.ok(out.equals(Buffer.concat([SOI, dqt, dri, sof, dht, sos, entropy, EOI])));
});

test('JPEG walker: multiple scans with tables between them, truncates at EOI after the last scan', () => {
  const sof = seg(0xc2, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
  const dht = seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  const scan1 = Buffer.from([0x01, 0xff, 0x00, 0x02]);
  const scan2 = Buffer.from([0x03, 0xff, 0xd3, 0x04]);
  const src = Buffer.concat([SOI, sof, dht, sos, scan1, dht, seg(0xe5, [1, 2]), sos, scan2, EOI, SOI, EOI]);
  const out = stripMetadata(src, 'image/jpeg');
  assert.ok(out.equals(Buffer.concat([SOI, sof, dht, sos, scan1, dht, sos, scan2, EOI])));
});

test('JPEG walker: keeps APP2 ICC and APP14 Adobe, drops other APP2/APP14 and JFXX', () => {
  const sof = seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  const icc = seg(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01data'));
  const mpf = seg(0xe2, Buffer.from('MPF\0secret'));
  const adobe = seg(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01'));
  const other14 = seg(0xee, Buffer.from('Other'));
  const jfxx = seg(0xe0, Buffer.from('JFXX\0\x10thumb'));
  const src = Buffer.concat([SOI, jfxx, icc, mpf, adobe, other14, sof, sos, Buffer.from([0x00]), EOI]);
  const out = stripMetadata(src, 'image/jpeg');
  assert.ok(out.equals(Buffer.concat([SOI, icc, adobe, sof, sos, Buffer.from([0x00]), EOI])));
});

test('truncated JPEG throws UnreadableImageError', () => {
  assert.throws(() => stripMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), 'image/jpeg'), UnreadableImageError);
});

test('malformed JPEGs throw UnreadableImageError with the public message', async () => {
  const good = await jpegWithGps();
  const sosAt = good.lastIndexOf(Buffer.from([0xff, 0xda]));
  const bad = [
    Buffer.alloc(0),
    Buffer.from([0xff, 0xd8]),
    Buffer.from('not a jpeg at all'),
    good.subarray(0, good.length - 2), 
    good.subarray(0, sosAt + 3), 
    Buffer.concat([SOI, EOI]), 
    Buffer.concat([SOI, Buffer.from([0x12, 0x34])]), 
    Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x00, 0x01])]), 
  ];
  for (const buf of bad) {
    assert.throws(() => stripMetadata(buf, 'image/jpeg'), {
      name: 'UnreadableImageError',
      message: 'This image could not be read.',
    });
  }
});

test('readOrientation reads little- and big-endian EXIF, 1 when absent or out of range', async () => {
  const le = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
    .withMetadata({ orientation: 5 })
    .jpeg()
    .toBuffer();
  assert.equal(readOrientation(le), 5);
  const tiff = (n) =>
    Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, n, 0, 0, 0, 0, 0, 0, 0, 0]);
  const sof = seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  const withApp1 = (n) =>
    Buffer.concat([SOI, seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), tiff(n)])), sof, sos, EOI]);
  assert.equal(readOrientation(withApp1(7)), 7);
  assert.equal(readOrientation(withApp1(9)), 1);
  assert.equal(readOrientation(withApp1(0)), 1);
  assert.equal(readOrientation(Buffer.concat([SOI, sof, sos, EOI])), 1);
  assert.equal(readOrientation(Buffer.concat([SOI, seg(0xe1, Buffer.from('Exif\0\0MM')), sof, sos, EOI])), 1);
});

function pngChunkTypes(buf) {
  const types = [];
  for (let pos = 8; pos < buf.length;) {
    const len = buf.readUInt32BE(pos);
    types.push(buf.subarray(pos + 4, pos + 8).toString('latin1'));
    pos += 12 + len;
  }
  return types;
}

test('PNG keeps only allowlisted chunks, byte-for-byte, and drops data after IEND', async () => {
  const src = Buffer.concat([await pngWithText(), Buffer.from('trailing secret')]);
  const out = stripMetadata(src, 'image/png');
  const types = pngChunkTypes(out);
  assert.ok(!types.includes('tEXt') && !types.includes('eXIf') && !types.includes('tIME'));
  assert.equal(types[0], 'IHDR');
  assert.equal(types.at(-1), 'IEND');
  assert.ok(types.includes('iCCP'));
  for (let pos = 8; pos < out.length;) {
    const chunk = out.subarray(pos, pos + 12 + out.readUInt32BE(pos));
    assert.ok(src.includes(chunk), 'every output chunk appears verbatim in the source');
    pos += chunk.length;
  }
});

test('PNG drops unknown, zTXt, iTXt chunks', async () => {
  const base = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
  const extra = Buffer.concat([
    pngChunk('zTXt', Buffer.from('k\0\0secret')),
    pngChunk('iTXt', Buffer.from('k\0\0\0\0\0secret')),
    pngChunk('prVt', Buffer.from('secret')),
  ]);
  const src = Buffer.concat([base.subarray(0, 33), extra, base.subarray(33)]);
  const out = stripMetadata(src, 'image/png');
  assert.ok(out.equals(base));
});

test('malformed PNGs throw UnreadableImageError', async () => {
  const good = await pngWithText();
  const bad = [
    Buffer.alloc(0),
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    Buffer.concat([Buffer.from('\x89PNX\r\n\x1a\n', 'latin1'), good.subarray(8)]),
    good.subarray(0, good.length - 12), 
    good.subarray(0, 40), 
    Buffer.concat([good.subarray(0, 8), good.subarray(33)]), 
  ];
  for (const buf of bad) assert.throws(() => stripMetadata(buf, 'image/png'), UnreadableImageError);
});

function riffChunks(buf) {
  const chunks = [];
  for (let pos = 12; pos < 8 + buf.readUInt32LE(4);) {
    const size = buf.readUInt32LE(pos + 4);
    chunks.push({
      id: buf.subarray(pos, pos + 4).toString('latin1'),
      size,
      data: buf.subarray(pos + 8, pos + 8 + size),
    });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

test('WebP drops EXIF/XMP chunks, clears VP8X flags, rewrites RIFF size', async () => {
  const src = await webpWithExif();
  const before = riffChunks(src);
  assert.ok(before.some((c) => c.id === 'EXIF') && before.some((c) => c.id === 'XMP '));
  assert.equal(before[0].data[0] & 0x0c, 0x0c);
  const out = stripMetadata(src, 'image/webp');
  const after = riffChunks(out);
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.deepEqual(
    after.map((c) => c.id),
    before.map((c) => c.id).filter((id) => id !== 'EXIF' && id !== 'XMP '),
  );
  assert.equal(after[0].id, 'VP8X');
  assert.equal(after[0].data[0], before[0].data[0] & ~0x0c);
  assert.ok(after[0].data.subarray(1).equals(before[0].data.subarray(1)));
  for (const c of after.slice(1)) assert.ok(before.find((b) => b.id === c.id).data.equals(c.data));
});

test('WebP preserves odd-size chunk padding and drops data after the RIFF end', async () => {
  const simple = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#abc' } })
    .webp({ lossless: true })
    .toBuffer();
  const imgChunk = simple.subarray(12);
  const vp8x = Buffer.from([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x08, 0, 0, 0, 3, 0, 0, 3, 0, 0]);
  const exif = Buffer.from('EXIF\x03\0\0\0abc\0', 'latin1'); 
  const odd = Buffer.from('ZZZZ\x03\0\0\0xyz\0', 'latin1'); 
  const body = Buffer.concat([Buffer.from('WEBP'), vp8x, exif, imgChunk, odd]);
  const head = Buffer.from('RIFF\0\0\0\0', 'latin1');
  head.writeUInt32LE(body.length, 4);
  const out = stripMetadata(Buffer.concat([head, body, Buffer.from('trailing')]), 'image/webp');
  const expectedVp8x = Buffer.from(vp8x);
  expectedVp8x[8] = 0;
  const expectedBody = Buffer.concat([Buffer.from('WEBP'), expectedVp8x, imgChunk, odd]);
  const expectedHead = Buffer.from('RIFF\0\0\0\0', 'latin1');
  expectedHead.writeUInt32LE(expectedBody.length, 4);
  assert.ok(out.equals(Buffer.concat([expectedHead, expectedBody])));
});

test('simple (non-VP8X) WebP passes through unchanged', async () => {
  const simple = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#abc' } })
    .webp()
    .toBuffer();
  assert.ok(stripMetadata(simple, 'image/webp').equals(simple));
});

test('malformed WebPs throw UnreadableImageError', async () => {
  const good = await webpWithExif();
  const bigSize = Buffer.from(good);
  bigSize.writeUInt32LE(good.length, 4);
  const bad = [
    Buffer.alloc(0),
    Buffer.from('RIFF\x04\0\0\0WEBP', 'latin1'), 
    Buffer.concat([Buffer.from('RIFF'), good.subarray(4, 8), Buffer.from('WAVE'), good.subarray(12)]),
    bigSize, 
    good.subarray(0, 20), 
  ];
  for (const buf of bad) assert.throws(() => stripMetadata(buf, 'image/webp'), UnreadableImageError);
});

test('unsupported mime throws UnreadableImageError', async () => {
  assert.throws(() => stripMetadata(Buffer.from('GIF89a'), 'image/gif'), UnreadableImageError);
});

test('STRIPPERS has a stripper for every accepted image type, and only those', () => {
  assert.deepEqual(Object.keys(STRIPPERS).sort(), [...IMAGE_TYPES].sort());
  for (const mime of IMAGE_TYPES) assert.equal(typeof STRIPPERS[mime], 'function', mime);
  assert.ok(Object.isFrozen(STRIPPERS));
  assert.deepEqual(
    [STRIPPERS['image/jpeg'], STRIPPERS['image/png'], STRIPPERS['image/webp']],
    [stripJpeg, stripPng, stripWebp],
    'one parser module per container',
  );
});
