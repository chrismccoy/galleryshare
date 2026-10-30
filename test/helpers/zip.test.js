import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './temp.js';
import { entriesOf, writeZip } from './zip.js';

test('entriesOf reads a 25-entry ZIP without piling up listeners', async (t) => {
  const warnings = [];
  const keep = (warning) => warnings.push(warning.name);
  process.on('warning', keep);
  t.after(() => process.off('warning', keep));
  const names = Array.from({ length: 25 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`);
  const file = await writeZip(
    path.join(tempDir(t, 'gs-zip-helper-'), 'many.zip'),
    names.map((name) => ({ name, data: name })),
  );
  const entries = await entriesOf(fs.readFileSync(file));
  assert.equal(entries.length, 25);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    warnings.filter((name) => name === 'MaxListenersExceededWarning'),
    [],
  );
});
