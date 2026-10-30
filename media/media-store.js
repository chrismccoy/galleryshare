import fs from 'node:fs';
import path from 'node:path';
import { ORIGINAL_EXTENSIONS } from './image-types.js';

export const IMAGE_SIZES = Object.freeze(['orig', 'web', 'thumb']);

export const PUBLIC_IMAGE_SIZES = Object.freeze(['thumb', 'web']);

export const isImageSize = (size) => IMAGE_SIZES.includes(size);

export const isPublicImageSize = (size) => PUBLIC_IMAGE_SIZES.includes(size);

function requirePositiveId(value, label) {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`Invalid ${label}`);
  return n;
}




export function createMediaStore(rootDir) {
  const galleryDir = (galleryId) => path.join(rootDir, String(requirePositiveId(galleryId, 'gallery id')));

  function paths({ galleryId, imageId, ext }) {
    const dir = galleryDir(galleryId);
    const id = requirePositiveId(imageId, 'image id');
    if (!ORIGINAL_EXTENSIONS.includes(ext)) throw new TypeError('Invalid image extension');
    return {
      orig: path.join(dir, 'orig', `${id}.${ext}`),
      web: path.join(dir, 'web', `${id}.webp`),
      thumb: path.join(dir, 'thumb', `${id}.webp`),
    };
  }

  async function writeAtomic(file, data) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const part = `${file}.part`;
    await fs.promises.writeFile(part, data);
    await fs.promises.rename(part, file);
    return data.length;
  }

  async function write(image, { original, web, thumb }) {
    const target = paths(image);
    try {
      return {
        bytesOrig: await writeAtomic(target.orig, original),
        bytesWeb: await writeAtomic(target.web, web),
        bytesThumb: await writeAtomic(target.thumb, thumb),
      };
    } catch (error) {
      await removeImage(image).catch(() => {});
      throw error;
    }
  }

  async function removeImage(image) {
    const files = Object.values(paths(image)).flatMap((file) => [file, `${file}.part`]);
    await Promise.all(files.map((file) => fs.promises.rm(file, { force: true })));
  }

  async function removeGallery(galleryId) {
    await fs.promises.rm(galleryDir(galleryId), { recursive: true, force: true });
  }

  function stream(image, size) {
    if (!isImageSize(size)) throw new TypeError('Invalid image size');
    return fs.createReadStream(paths(image)[size]);
  }

  function read(image, size) {
    if (!isImageSize(size)) throw new TypeError('Invalid image size');
    return fs.promises.readFile(paths(image)[size]);
  }

  return { paths, write, removeImage, removeGallery, stream, read };
}
