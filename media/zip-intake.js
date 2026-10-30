import yauzl from 'yauzl';
import { LimitExceededError, UnreadableImageError } from '../lib/errors.js';
import { toMb } from '../lib/size.js';
import { IMAGE_TYPES_TEXT, SNIFF_BYTES, UNREADABLE_IMAGE_MESSAGE, isImageName, sniffImageType } from './image-types.js';

const CORRUPT_MESSAGE = 'This ZIP file could not be read.';

export const NOT_AN_IMAGE_MESSAGE = `Not a ${IMAGE_TYPES_TEXT} image.`;

const REQUIRED_LIMITS = Object.freeze(['maxEntryBytes', 'maxTotalBytes', 'maxEntries', 'maxExamined', 'maxRejected']);

export const ZIP_LIMIT = Object.freeze({
  images: 'zip-too-many-images',
  files: 'zip-too-many-files',
  notImages: 'zip-too-many-not-images',
});

function zipLimitError(message, code) {
  return new LimitExceededError(message, { code });
}

const tooManyImages = (name, maxEntries) =>
  zipLimitError(`${name} has more than ${maxEntries} images; at most ${maxEntries} can be added.`, ZIP_LIMIT.images);

export const entryBasename = (name) => name.slice(name.lastIndexOf('/') + 1);

export const zipEntryLabel = (zipName, entryName) => `${zipName}/${entryBasename(entryName)}`;

function isImageEntry(name) {
  if (name.endsWith('/')) return false;
  if (name.startsWith('__MACOSX/')) return false;
  const base = entryBasename(name);
  return !base.startsWith('.') && isImageName(base);
}

function openZip(zipPath, options = {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, ...options }, (error, zipfile) =>
      error ? reject(new UnreadableImageError(CORRUPT_MESSAGE, { cause: error })) : resolve(zipfile),
    );
  });
}

function eachEntry(zipfile, onEntry) {
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      zipfile.close();
      reject(
        error instanceof UnreadableImageError ? error : new UnreadableImageError(CORRUPT_MESSAGE, { cause: error }),
      );
    };
    zipfile.on('error', fail);
    zipfile.on('end', resolve);
    zipfile.on('entry', (entry) => {
      try {
        onEntry(entry);
      } catch (error) {
        zipfile.close();
        reject(error);
        return;
      }
      zipfile.readEntry();
    });
    zipfile.readEntry();
  });
}


function openEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

async function sniffEntry(zipfile, entry) {
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of await openEntry(zipfile, entry)) {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= SNIFF_BYTES) break;
    }
  } catch {
    return UNREADABLE_IMAGE_MESSAGE;
  }
  const head = Buffer.concat(chunks, length).subarray(0, SNIFF_BYTES);
  return sniffImageType(head) ? null : NOT_AN_IMAGE_MESSAGE;
}

async function collectCandidates(zipfile, { maxEntryBytes, maxTotalBytes, maxEntries, maxExamined, sniff, name }) {
  const candidates = [];
  let total = 0;
  let examined = 0;
  await eachEntry(zipfile, (entry) => {
    examined += 1;
    if (examined > maxExamined) {
      throw zipLimitError(`${name} has too many files (more than ${maxExamined}).`, ZIP_LIMIT.files);
    }
    if (!isImageEntry(entry.fileName)) return;
    if (entry.uncompressedSize > maxEntryBytes) {
      throw new LimitExceededError(`${entryBasename(entry.fileName)} is larger than ${toMb(maxEntryBytes)} MB.`);
    }
    total += entry.uncompressedSize;
    if (total > maxTotalBytes) {
      throw new LimitExceededError(`The images in this ZIP are over ${toMb(maxTotalBytes)} MB in total.`);
    }
    candidates.push(entry);
    if (!sniff && candidates.length > maxEntries) throw tooManyImages(name, maxEntries);
  });
  return candidates;
}

async function classifyCandidates(zipfile, candidates, { maxEntries, maxRejected, sniff, name }) {
  const entries = [];
  const rejected = [];
  for (const entry of candidates) {
    const reason = sniff ? await sniffEntry(zipfile, entry) : null;
    if (reason) {
      rejected.push({ name: entry.fileName, reason });
      if (rejected.length > maxRejected) {
        throw zipLimitError(`${name} has too many files that are not real images.`, ZIP_LIMIT.notImages);
      }
      continue;
    }
    entries.push({ name: entry.fileName, size: entry.uncompressedSize });
    if (entries.length > maxEntries) throw tooManyImages(name, maxEntries);
  }
  return { entries, rejected };
}

export async function inspectZip(zipPath, limits) {
  for (const key of REQUIRED_LIMITS) {
    if (!Number.isFinite(limits[key])) throw new TypeError(`inspectZip needs a finite number for limits.${key}`);
  }
  const { sniff = false, name = 'This ZIP' } = limits;
  const checked = { ...limits, sniff, name };
  const zipfile = await openZip(zipPath, { autoClose: false });
  try {
    const candidates = await collectCandidates(zipfile, checked);
    return await classifyCandidates(zipfile, candidates, checked);
  } finally {
    zipfile.close();
  }
}

async function readEntry(zipfile, entry) {
  const chunks = [];
  for await (const chunk of await openEntry(zipfile, entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function* zipImages(zipPath, names) {
  const zipfile = await openZip(zipPath, { autoClose: false });
  try {
    const byName = new Map();
    await eachEntry(zipfile, (entry) => {
      if (names.has(entry.fileName) && !byName.has(entry.fileName)) byName.set(entry.fileName, entry);
    });
    for (const name of names) {
      const entry = byName.get(name);
      if (!entry) {
        yield { name, error: new UnreadableImageError(CORRUPT_MESSAGE) };
        continue;
      }
      let buffer;
      try {
        buffer = await readEntry(zipfile, entry);
      } catch (cause) {
        yield { name, error: new UnreadableImageError(UNREADABLE_IMAGE_MESSAGE, { cause }) };
        continue;
      }
      yield { name, buffer };
    }
  } finally {
    zipfile.close();
  }
}
