import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config/root.js';
import { checkSource, selectEnforced, sourceTypeFor } from '../helpers/jsdoc-guard.js';
import { NO_GIT_REASON, projectFiles } from '../helpers/project-files.js';

const PROJECT_FILES = projectFiles({ untracked: true });

test(
  'JSDoc guard: enforced files have a header and documented functions',
  { skip: PROJECT_FILES === null && NO_GIT_REASON },
  () => {
    const files = selectEnforced(PROJECT_FILES);
    assert.ok(files.length > 0, 'no enforced files found');
    const problems = [];
    for (const file of files) {
      const code = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
      problems.push(...checkSource(code, file, sourceTypeFor(file)));
    }
    assert.deepEqual(problems, [], `JSDoc violations:\n${problems.join('\n')}`);
  },
);

function jsdocImportPaths(code) {
  const paths = [];
  for (const [block] of code.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    for (const [, target] of block.matchAll(/import\('(\.{1,2}\/[^']+)'\)/g)) paths.push(target);
  }
  return paths;
}

test(
  'JSDoc guard: every import() type path in a doc comment points at a file that exists',
  { skip: PROJECT_FILES === null && NO_GIT_REASON },
  () => {
    const broken = [];
    for (const file of selectEnforced(PROJECT_FILES).filter((name) => !name.startsWith('test/guards/'))) {
      const code = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
      for (const target of jsdocImportPaths(code)) {
        if (!fs.existsSync(path.resolve(PROJECT_ROOT, path.dirname(file), target))) broken.push(`${file}: ${target}`);
      }
    }
    assert.deepEqual(broken, [], `JSDoc types that resolve to no file:\n${broken.join('\n')}`);
  },
);

test('JSDoc guard self-test: finds the import() type paths of doc comments only', () => {
  const code =
    "/** @param {import('../a.js').A} a - A. */\nconst x = import('./lazy.js');\n/** @type {import('./b.js').B} */";
  assert.deepEqual(jsdocImportPaths(code), ['../a.js', './b.js']);
});

test('JSDoc guard self-test: a file in a brand-new folder is enforced, exclusions are not', () => {
  const picked = selectEnforced([
    'brand-new-dir/deep/x.js',
    'tools/y.mjs',
    'public/vendor/lib.js',
    'public/screenshots/generated.js',
    'views/pages/a.ejs',
    'README.md',
  ]);
  assert.deepEqual(picked, ['brand-new-dir/deep/x.js', 'tools/y.mjs']);
  assert.match(
    checkSource('const x = 1;\n', picked[0]).join('\n'),
    /brand-new-dir\/deep\/x\.js:1 \(file\) — missing @file/,
  );
});

test('JSDoc guard self-test: catches a missing file header', () => {
  const code = '/** Adds. @returns {number} sum */\nfunction add() { return 1; }\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /missing @file header/);
});

test('JSDoc guard self-test: catches a header without @module, and a browser script that needs none', () => {
  const code = '/** @file Demo. */\nconst x = 1;\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /x\.js:1 \(file\) — missing @module/);
  assert.deepEqual(checkSource(code, 'x.js', 'script'), []);
  assert.deepEqual(checkSource('/** @file Demo.\n * @module x */\nconst x = 1;\n', 'x.js'), []);
});

test('JSDoc guard self-test: catches a header that comes after code', () => {
  const code = 'const x = 1;\n/** @file Demo.\n * @module x */\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /header must come before any code/);
});

test('JSDoc guard self-test: catches undocumented export default functions', () => {
  const head = '/** @file Demo.\n * @module x */\n';
  assert.match(
    checkSource(`${head}export default function (a) { return a; }\n`, 'x.js').join('\n'),
    /x\.js:3 default — missing JSDoc block/,
  );
  assert.match(
    checkSource(`${head}export default (a) => a;\n`, 'x.js').join('\n'),
    /x\.js:3 default — missing JSDoc block/,
  );
  assert.deepEqual(checkSource(`${head}export default function named() {}\nvoid 0;\n`, 'x.js'), [
    'x.js:3 named — missing JSDoc block',
  ]);
  const documented = `${head}/**\n * Doubles.\n * @param {number} a - Input.\n * @returns {number} Result.\n */\nexport default (a) => a * 2;\n`;
  assert.deepEqual(checkSource(documented, 'x.js'), []);
});

test('JSDoc guard self-test: catches undocumented assignment-form functions', () => {
  const head = '/** @file Demo.\n * @module x */\n';
  assert.match(
    checkSource(`${head}const api = {};\napi.run = function (x) {};\n`, 'x.js').join('\n'),
    /x\.js:4 api\.run — missing JSDoc block/,
  );
  assert.match(
    checkSource(`${head}module.exports = () => 1;\n`, 'x.js').join('\n'),
    /x\.js:3 module\.exports — missing JSDoc block/,
  );
  assert.match(checkSource(`${head}let f;\nf = (a) => a;\n`, 'x.js').join('\n'), /x\.js:4 f — missing JSDoc block/);
  const documented = `${head}const api = {};\n/**\n * Runs.\n * @param {number} x - Input.\n * @returns {number} Same.\n */\napi.run = (x) => x;\n`;
  assert.deepEqual(checkSource(documented, 'x.js'), []);
});

test('JSDoc guard self-test: a lone @typedef block does not document a function', () => {
  const code = '/** @file Demo.\n * @module x */\n/** @typedef {number} Id */\nfunction run() {}\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /x\.js:4 run — missing JSDoc block/);
});

test('JSDoc guard self-test: a block with both a @typedef and the function tags documents the function', () => {
  const head = '/** @file Demo.\n * @module x */\n';
  const both = `${head}/**\n * @typedef {number} Id\n * Runs.\n * @param {Id} a - Input.\n * @returns {Id} Same.\n */\nfunction run(a) { return a; }\n`;
  assert.deepEqual(checkSource(both, 'x.js'), []);
  const wrong = `${head}/**\n * @typedef {number} Id\n * Runs.\n * @returns {Id} Same.\n */\nfunction run(a) { return a; }\n`;
  assert.match(checkSource(wrong, 'x.js').join('\n'), /x\.js:8 run — missing @param/);
});

test('JSDoc guard self-test: checks class methods and constructors', () => {
  const head = '/** @file Demo.\n * @module x */\n';
  const missing = `${head}export class A {\n  run(x) { return x; }\n}\n`;
  assert.match(checkSource(missing, 'x.js').join('\n'), /x\.js:4 run — missing JSDoc block/);
  const noReturns = `${head}export class A {\n  /**\n   * Runs.\n   * @param {number} x - Input.\n   */\n  run(x) { return x; }\n}\n`;
  assert.match(checkSource(noReturns, 'x.js').join('\n'), /x\.js:8 run — missing @returns/);
  const ctor = `${head}export class A {\n  /**\n   * Creates it.\n   * @param {number} x - Input.\n   */\n  constructor(x) { this.x = x; }\n}\n`;
  assert.deepEqual(checkSource(ctor, 'x.js'), []);
  const ctorNoParam = `${head}export class A {\n  /** Creates it. */\n  constructor(x) { this.x = x; }\n}\n`;
  assert.match(checkSource(ctorNoParam, 'x.js').join('\n'), /x\.js:5 constructor — missing @param/);
});

test('JSDoc guard self-test: catches a missing @param', () => {
  const code =
    '/** @file Demo.\n * @module x */\n/**\n * Adds.\n * @param {number} a - First.\n * @returns {number} Sum.\n */\nfunction add(a, b) { return a + b; }\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /x\.js:8 add — missing @param/);
});

test('JSDoc guard self-test: a @param must carry the name the code gives the parameter', () => {
  const head = '/** @file Demo.\n * @module x */\n';
  const source = (params, tag) =>
    `${head}/**\n * Runs.\n * @param {number} ${tag} - Input.\n * @returns {number} Same.\n */\nfunction run(${params}) { return 1; }\n`;
  assert.match(
    checkSource(source('a', 'b'), 'x.js').join('\n'),
    /x\.js:8 run — @param 1 is named b, the code calls it a/,
  );
  assert.deepEqual(checkSource(source('a', 'a'), 'x.js'), []);
  assert.deepEqual(checkSource(source('a = 1', '[a=1]'), 'x.js'), [], 'optional with a default');
  assert.deepEqual(checkSource(source('...rest', 'rest'), 'x.js'), []);
  assert.match(checkSource(source('...rest', 'other'), 'x.js').join('\n'), /the code calls it rest/);
  assert.deepEqual(checkSource(source('{ a, b }', 'options'), 'x.js'), [], 'a destructured parameter has any name');
});

test('JSDoc guard self-test: catches a missing @returns', () => {
  const code =
    '/** @file Demo.\n * @module x */\n/**\n * Adds.\n * @param {number} a - First.\n */\nconst add = (a) => a + 1;\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /x\.js:7 add — missing @returns/);
});

test('JSDoc guard self-test: catches an undocumented method and a missing block', () => {
  const code = '/** @file Demo.\n * @module x */\nexport const make = {\n  run(x) {},\n};\n';
  assert.match(checkSource(code, 'x.js').join('\n'), /x\.js:4 run — missing JSDoc block/);
});

test('JSDoc guard self-test: accepts a correct block and exempts anonymous callbacks', () => {
  const code = [
    '/** @file Demo.',
    ' * @module x */',
    '/**',
    ' * Adds.',
    ' * @param {{ a: number }} options - Options.',
    ' * @param {number} options.a - First.',
    ' * @returns {number} Sum.',
    ' */',
    'export function add({ a }) { return [1].map((n) => n + a)[0]; }',
    '/**',
    ' * Does nothing.',
    ' * @param {number} n - Input.',
    ' */',
    'export const noop = (n) => { void n; };',
    '',
  ].join('\n');
  assert.deepEqual(checkSource(code, 'x.js'), []);
});
