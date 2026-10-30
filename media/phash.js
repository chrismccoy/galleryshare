import sharp from 'sharp';

const HASH_SIZE = 8;

export const MAX_DUPLICATE_DISTANCE = 6;

export async function dhash(buf, { limitInputPixels } = {}) {
  const width = HASH_SIZE + 1;
  const pixels = await sharp(buf, { failOn: 'error', ...(limitInputPixels && { limitInputPixels }) })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(width, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      hash = (hash << 1n) | (pixels[y * width + x] > pixels[y * width + x + 1] ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(HASH_SIZE * 2, '0');
}

export function hammingDistance(a, b) {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  for (; diff; diff &= diff - 1n) count += 1;
  return count;
}

export const isNearDuplicate = (a, b) => hammingDistance(a, b) <= MAX_DUPLICATE_DISTANCE;
