import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { PROJECT_ROOT } from '../../config/root.js';
import { selectEnforced, sourceTypeFor } from '../helpers/jsdoc-guard.js';
import { NO_GIT_REASON, projectFiles } from '../helpers/project-files.js';

const PROJECT_FILES = projectFiles({ untracked: true });

function unusedImports(code) {
  const options = { ecmaVersion: 'latest', sourceType: 'module' };
  const imports = acorn.parse(code, options).body.filter((node) => node.type === 'ImportDeclaration');
  const inImport = (at) => imports.some((node) => at >= node.start && at < node.end);
  const used = new Set();
  for (const token of acorn.tokenizer(code, options)) {
    if (token.type.label === 'name' && !inImport(token.start)) used.add(token.value);
  }
  return imports.flatMap((node) => node.specifiers.map((spec) => spec.local.name)).filter((name) => !used.has(name));
}

test('imports guard: no module imports a name it never uses', { skip: PROJECT_FILES === null && NO_GIT_REASON }, () => {
  const problems = [];
  for (const file of selectEnforced(PROJECT_FILES)) {
    if (sourceTypeFor(file) !== 'module') continue;
    const code = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    for (const name of unusedImports(code)) problems.push(`${file}: ${name}`);
  }
  assert.deepEqual(problems, [], `Unused imports:\n${problems.join('\n')}`);
});

test('imports guard self-test: a name used only in a comment, a string or the import itself is unused', () => {
  const code = [
    "import fs from 'node:fs';",
    "import { a, b, c, d } from './x.js';",
    '/** @param {a} x - Only a type. */',
    "const text = 'b';",
    'export const e = `${c}`;',
    'd();',
  ].join('\n');
  assert.deepEqual(unusedImports(code), ['fs', 'a', 'b']);
});
