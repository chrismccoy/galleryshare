import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_EXTENSIONS,
  IMAGE_FORMATS,
  IMAGE_TYPES,
  IMAGE_TYPES_TEXT,
  ORIGINAL_EXTENSIONS,
  UNREADABLE_IMAGE_MESSAGE,
  UNSUPPORTED_IMAGE_MESSAGE,
  UNSUPPORTED_UPLOAD_MESSAGE,
  UPLOAD_ACCEPT,
  UPLOAD_RULES,
  ZIP_EXTENSIONS,
  ZIP_TYPES,
  assertSignatures,
  extForMime,
  hasSignature,
  isImageName,
  isZipUpload,
  sniffImageType,
  uploadKind,
} from '../../media/image-types.js';
import { GIF_BYTES, makeJpeg, makePng, makeWebp } from '../helpers/images.js';

test('IMAGE_FORMATS is a frozen table with one row per format', () => {
  assert.ok(Object.isFrozen(IMAGE_FORMATS));
  assert.ok(IMAGE_FORMATS.every((format) => Object.isFrozen(format) && Object.isFrozen(format.names)));
  assert.deepEqual(
    IMAGE_FORMATS.map(({ mime, ext, label }) => [mime, ext, label]),
    [
      ['image/jpeg', 'jpg', 'JPEG'],
      ['image/png', 'png', 'PNG'],
      ['image/webp', 'webp', 'WebP'],
    ],
  );
  for (const format of IMAGE_FORMATS) {
    assert.ok(format.names.includes(format.ext), `${format.ext} is one of its own names`);
    for (const name of format.names) assert.match(name, /^[a-z0-9]+$/, 'names are safe inside a RegExp');
  }
});

test('the lists, messages and accept rules derive from IMAGE_FORMATS (texts unchanged)', () => {
  assert.deepEqual(IMAGE_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  assert.deepEqual(IMAGE_EXTENSIONS, ['jpg', 'jpeg', 'png', 'webp']);
  assert.deepEqual(ORIGINAL_EXTENSIONS, ['jpg', 'png', 'webp']);
  assert.deepEqual(ZIP_EXTENSIONS, ['zip']);
  assert.deepEqual(ZIP_TYPES, ['application/zip', 'application/x-zip-compressed', 'application/x-zip']);
  assert.equal(IMAGE_TYPES_TEXT, 'JPEG, PNG or WebP');
  assert.equal(UNSUPPORTED_IMAGE_MESSAGE, 'Use a JPEG, PNG or WebP photo.');
  assert.equal(UNSUPPORTED_UPLOAD_MESSAGE, 'Only JPEG, PNG, WebP images or ZIP files can be uploaded.');
  assert.equal(UNREADABLE_IMAGE_MESSAGE, 'This image could not be read.');
  assert.equal(UPLOAD_ACCEPT, 'image/jpeg,image/png,image/webp,.zip,application/zip');
  assert.deepEqual(UPLOAD_RULES, {
    imageExts: 'jpg,jpeg,png,webp',
    imageTypes: 'image/jpeg,image/png,image/webp',
    zipExts: 'zip',
    zipTypes: 'application/zip,application/x-zip-compressed,application/x-zip',
    unsupported: UNSUPPORTED_UPLOAD_MESSAGE,
  });
  for (const list of [IMAGE_TYPES, IMAGE_EXTENSIONS, ORIGINAL_EXTENSIONS, ZIP_EXTENSIONS, ZIP_TYPES, UPLOAD_RULES]) {
    assert.ok(Object.isFrozen(list));
  }
});

test('extForMime gives the stored extension of each format and null for anything else', () => {
  for (const format of IMAGE_FORMATS) assert.equal(extForMime(format.mime), format.ext);
  assert.equal(extForMime('image/gif'), null);
  assert.equal(extForMime(undefined), null);
});

test('sniffImageType detects every format by its signature', async () => {
  assert.equal(sniffImageType(await makeJpeg()), 'image/jpeg');
  assert.equal(sniffImageType(await makePng()), 'image/png');
  assert.equal(sniffImageType(await makeWebp()), 'image/webp');
  assert.equal(sniffImageType(GIF_BYTES), null);
  assert.equal(sniffImageType(Buffer.alloc(4)), null);
  assert.equal(sniffImageType('nope'), null);
});

test('isImageName matches the image extensions of the table, in any case', () => {
  for (const name of ['a.jpg', 'b.JPEG', 'c.Png', 'd.webp', '.jpg']) assert.equal(isImageName(name), true, name);
  for (const name of ['jpg', 'a.gif', 'a.jpg.txt', 'a.zip', 'a.jpgx', '']) assert.equal(isImageName(name), false, name);
});

test('uploadKind: a known extension decides, the MIME type counts only when the name has none', () => {
  assert.equal(uploadKind('a.jpg', 'application/zip'), 'image');
  assert.equal(uploadKind('a.zip', 'image/jpeg'), 'zip');
  assert.equal(uploadKind('a.ZIP', ''), 'zip');
  assert.equal(uploadKind('photo', 'image/webp'), 'image');
  assert.equal(uploadKind('archive', 'application/x-zip-compressed'), 'zip');
  assert.equal(uploadKind('a.gif', 'image/png'), 'image', 'an unknown extension falls back to the MIME type');
  assert.equal(uploadKind('a.gif', 'image/gif'), null);
  assert.equal(uploadKind('notes.txt', 'text/plain'), null);
  assert.equal(uploadKind('notes', undefined), null);
});

test('every format names a known signature; assertSignatures fails fast on an unknown one', () => {
  assert.doesNotThrow(() => assertSignatures(IMAGE_FORMATS));
  assert.throws(
    () =>
      assertSignatures([
        ...IMAGE_FORMATS,
        { mime: 'image/avif', ext: 'avif', names: ['avif'], label: 'AVIF', signature: 'avif' },
      ]),
    /image\/avif.*avif/,
  );
});

test('hasSignature checks one signature by id and needs SNIFF_BYTES bytes', async () => {
  const webp = await makeWebp();
  assert.equal(hasSignature(webp, 'webp'), true);
  assert.equal(hasSignature(webp, 'jpeg'), false);
  assert.equal(hasSignature(webp.subarray(0, 11), 'webp'), false);
  assert.equal(hasSignature('RIFF....WEBP', 'webp'), false);
});

test('isZipUpload: an uploaded file is a ZIP by uploadKind, from its name or else its MIME type', () => {
  assert.equal(isZipUpload({ originalname: 'photos.ZIP', mimetype: 'application/octet-stream' }), true);
  assert.equal(isZipUpload({ originalname: 'photos', mimetype: 'application/zip' }), true);
  assert.equal(isZipUpload({ originalname: 'photo.jpg', mimetype: 'application/zip' }), false, 'the name decides');
  assert.equal(isZipUpload({ originalname: 'notes.txt' }), false);
});
