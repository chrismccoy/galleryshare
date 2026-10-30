import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../db/database.js';
import { tempDir } from '../helpers/temp.js';

test('openDatabase creates the parent folder of the file and turns WAL and foreign keys on', (t) => {
  const file = path.join(tempDir(t, 'gs-open-'), 'odd #dir', 'app.sqlite');
  const db = openDatabase(file);
  try {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  } finally {
    db.close();
  }
  assert.ok(fs.existsSync(file));
});
