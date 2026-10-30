import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '../helpers/temp.js';
import { recordingLogger } from '../helpers/logger.js';
import { removeTempFile, removeTempFiles } from '../../lib/temp-files.js';

test('removeTempFiles removes the files, ignores missing ones and logs a failure without rejecting', async (t) => {
  const root = tempDir(t, 'gs-temp-files-');
  const file = path.join(root, 'a');
  fs.writeFileSync(file, 'x');
  const folder = path.join(root, 'folder');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'inside'), 'x');
  const { logger, warn } = recordingLogger();
  await removeTempFiles([file, path.join(root, 'missing'), folder], logger);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(folder), true);
  assert.equal(warn.length, 1);
  assert.equal(warn[0][0], 'temp file not removed');
  assert.equal(typeof warn[0][1].error, 'string');
  assert.equal(await removeTempFile(path.join(root, 'gone'), logger), undefined);
  assert.equal(warn.length, 1, 'a missing file is not a failure');
});
