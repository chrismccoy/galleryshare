import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config/root.js';
import { NO_GIT_REASON, projectFiles } from '../helpers/project-files.js';

const join = (...parts) => parts.join('');
const BANNED = [
  { name: 'old app name', pattern: new RegExp(join('flu', 'shed'), 'i'), examples: [join('Flu', 'shed')] },
  { name: join('uri', 'ne'), pattern: new RegExp(`\\b${join('uri', 'ne')}`, 'i'), examples: [join('URI', 'NE')] },
  { name: join('sto', 'ol'), pattern: new RegExp(`\\b${join('sto', 'ol')}`, 'i'), examples: [join('Sto', 'ol')] },
  { name: join('open', 'ai'), pattern: new RegExp(join('open', 'ai'), 'i'), examples: [join('Open', 'AI')] },
  {
    name: join('swa', 'tch'),
    pattern: new RegExp(`\\b${join('swa', 'tch')}(es)?\\b`, 'i'),
    examples: [join('swa', 'tches')],
  },
  { name: join('drop', 'let'), pattern: new RegExp(join('drop', 'let'), 'i'), examples: [join('fa-drop', 'let')] },
  {
    name: join('sample', ' type'),
    pattern: new RegExp(join('sample', '[ _]?', 'type'), 'i'),
    examples: [join('sample', '_type'), join('sample', 'Type'), join('sample', ' type')],
  },
];

const PROJECT_FILES = projectFiles({ untracked: true });

test(
  'no tracked or new file mentions the old app name or its domain words',
  { skip: PROJECT_FILES === null && NO_GIT_REASON },
  () => {
    const files = PROJECT_FILES;
    assert.ok(files.length > 100, `found ${files.length} project files`);
    const hits = [];
    for (const file of files) {
      const full = path.join(PROJECT_ROOT, file);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full).toString('latin1');
      for (const { name, pattern } of BANNED) {
        if (pattern.test(file)) hits.push(`${file}: ${name} (path)`);
        if (pattern.test(text)) hits.push(`${file}: ${name}`);
      }
    }
    assert.deepEqual(hits, []);
  },
);

test('the banned patterns catch what they are meant to, and leave ordinary words alone', () => {
  const caught = (text) => BANNED.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  for (const { name, examples } of BANNED) {
    for (const text of examples) assert.deepEqual(caught(text), [name], text);
  }
  for (const ok of ['result', 'credit', 'prompt', 'sample', 'samples typed', join('swa', 'tchbook')]) {
    assert.deepEqual(caught(ok), [], ok);
  }
});
