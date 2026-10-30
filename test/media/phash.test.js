import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MAX_DUPLICATE_DISTANCE, dhash, hammingDistance, isNearDuplicate } from '../../media/phash.js';
import { picture } from '../helpers/images.js';

test('dhash gives 16 hex characters (64 bits) and the same hash for the same bytes', async () => {
  const jpeg = await picture(1).jpeg().toBuffer();
  const hash = await dhash(jpeg);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(await dhash(jpeg), hash);
});

test('hammingDistance counts the differing bits', () => {
  assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0);
  assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4);
  assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64);
  assert.equal(hammingDistance('8000000000000001', '0000000000000000'), 2);
});

test('a resized, recompressed copy is a near duplicate', async () => {
  const original = await picture(2).jpeg({ quality: 95 }).toBuffer();
  const smaller = await sharp(original).resize(320).jpeg({ quality: 50 }).toBuffer();
  assert.ok(isNearDuplicate(await dhash(original), await dhash(smaller)));
});

test('the same picture as PNG and as WebP is a near duplicate', async () => {
  const png = await picture(3).png().toBuffer();
  const webp = await sharp(png).webp({ quality: 70 }).toBuffer();
  assert.ok(isNearDuplicate(await dhash(png), await dhash(webp)));
});

test('a photo tagged to be rotated matches its upright copy (EXIF rotation applied first)', async () => {
  const upright = await picture(4).jpeg().toBuffer();
  const tagged = await sharp(upright).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.ok(isNearDuplicate(await dhash(upright), await dhash(tagged)));
});

test('a picture with transparency hashes like the same picture on white', async () => {
  const opaque = await picture(5).png().toBuffer();
  const withAlpha = await sharp(opaque).ensureAlpha().png().toBuffer();
  assert.ok(isNearDuplicate(await dhash(opaque), await dhash(withAlpha)));
});

test('different pictures are not near duplicates', async () => {
  const hashes = await Promise.all(
    [10, 11, 12, 13, 14].map(async (seed) => dhash(await picture(seed).png().toBuffer())),
  );
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      assert.ok(
        hammingDistance(hashes[i], hashes[j]) > MAX_DUPLICATE_DISTANCE,
        `pictures ${i} and ${j}: ${hammingDistance(hashes[i], hashes[j])} bits apart`,
      );
    }
  }
});

test('isNearDuplicate allows at most MAX_DUPLICATE_DISTANCE (6) differing bits', () => {
  assert.equal(MAX_DUPLICATE_DISTANCE, 6);
  assert.ok(isNearDuplicate('0000000000000000', '000000000000003f'), '6 bits apart');
  assert.ok(!isNearDuplicate('0000000000000000', '000000000000007f'), '7 bits apart');
});
