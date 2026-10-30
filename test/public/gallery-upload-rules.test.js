import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_MB } from '../../lib/size.js';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PROJECT_ROOT } from '../../config/root.js';


const DATASET = {
  imageExts: 'jpg,jpeg,png',
  imageTypes: 'image/jpeg,image/png',
  zipExts: 'zip',
  zipTypes: 'application/zip',
  unsupported: 'Only images and ZIP files.',
  maxImageMb: '2',
  maxZipMb: '5',
  maxBatchMb: '6',
};

function rulesFor(dataset) {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'gallery-upload-rules.js'), 'utf8');
  const sandbox = {
    document: {
      querySelector: () => null,
    },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.galleryUploadRules(dataset);
}

const file = (name, size, type = '') => ({ name, size, type });

test('megabytes rounds to one decimal below 10 MB, to whole megabytes above, and never shows 0', () => {
  const { megabytes } = rulesFor(DATASET);
  assert.equal(megabytes(0.4 * BYTES_PER_MB), '0.4 MB');
  assert.equal(megabytes(1), '0.1 MB');
  assert.equal(megabytes(38.4 * BYTES_PER_MB), '38 MB');
});

test('isOversize and limitMbOf apply the image limit to images and the ZIP limit to ZIP files', () => {
  const { isOversize, limitMbOf } = rulesFor(DATASET);
  assert.equal(isOversize(file('a.jpg', 2 * BYTES_PER_MB)), false, 'at the limit');
  assert.equal(isOversize(file('a.jpg', 2 * BYTES_PER_MB + 1)), true);
  assert.equal(isOversize(file('a.zip', 3 * BYTES_PER_MB)), false, 'a ZIP has its own limit');
  assert.equal(isOversize(file('a.zip', 5 * BYTES_PER_MB + 1)), true);
  assert.equal(isOversize(file('a.txt', 50 * BYTES_PER_MB)), false, 'an unsupported file is refused, not oversize');
  assert.equal(limitMbOf(file('a.png', 1)), '2');
  assert.equal(limitMbOf(file('a.zip', 1)), '5');
  assert.equal(
    rulesFor({ ...DATASET, maxImageMb: '' }).isOversize(file('a.jpg', 99 * BYTES_PER_MB)),
    false,
    'no limit set',
  );
});

test('classify: nothing chosen, an unsupported file, a sendable mix with its summary, and a batch over the limit', () => {
  const { classify } = rulesFor(DATASET);
  assert.deepEqual({ ...classify([]) }, { kind: 'none', message: '', summary: '', overBatch: false });
  assert.deepEqual(
    { ...classify([file('a.jpg', BYTES_PER_MB), file('notes.txt', 1)]) },
    { kind: 'invalid', message: 'Only images and ZIP files.', summary: '', overBatch: false },
  );
  assert.deepEqual(
    { ...classify([file('a.jpg', BYTES_PER_MB), file('b.zip', BYTES_PER_MB), file('c.zip', BYTES_PER_MB / 2)]) },
    { kind: 'ok', message: '', summary: '1 image and 2 ZIP files, 2.5 MB', overBatch: false },
  );
  assert.deepEqual(
    { ...classify([file('a.zip', 4 * BYTES_PER_MB), file('b.zip', 3 * BYTES_PER_MB)]) },
    { kind: 'invalid', message: '', summary: '2 ZIP files, 7 MB — over the 6 MB upload limit', overBatch: true },
  );
});

test('classify: one file over its own size limit makes the whole selection unsendable; its row shows why', () => {
  const { classify } = rulesFor(DATASET);
  assert.deepEqual(
    { ...classify([file('a.jpg', BYTES_PER_MB), file('big.jpg', 3 * BYTES_PER_MB)]) },
    { kind: 'invalid', message: '', summary: '2 images, 4 MB', overBatch: false },
  );
});
