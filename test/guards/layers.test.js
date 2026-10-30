import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config/root.js';
import { NO_GIT_REASON, projectFiles } from '../helpers/project-files.js';
import { buildContext } from '../helpers/context.js';
import { createRepositories } from '../../app/context.js';
import * as ingestJobsRepository from '../../db/ingest-jobs.repository.js';
import * as gallerySharesRepository from '../../db/gallery-shares.repository.js';
import * as ingestServiceModule from '../../services/ingest.service.js';

const BOOT_ONLY_REPOSITORIES = ['resetTokens', 'sessions', 'users'];

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function importsOf(source) {
  const code = withoutComments(source);
  const found = [];
  for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g))
    found.push(match[1]);
  for (const match of code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) found.push(match[1]);
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

const JS_FILES = (projectFiles({ untracked: true }) ?? []).filter((file) => file.endsWith('.js'));
const SKIP_SCAN = JS_FILES.length === 0 && NO_GIT_REASON;
const ROUTE_FILES = JS_FILES.filter((file) => file.startsWith('routes/'));
const DOMAIN_FILES = JS_FILES.filter((file) => file.startsWith('domain/'));
const LIB_FILES = JS_FILES.filter((file) => file.startsWith('lib/'));
const MEDIA_FILES = JS_FILES.filter((file) => file.startsWith('media/'));

const DOMAIN_LIB_EDGES = [
  'domain/accounts.js -> lib/errors.js',
  'domain/gallery.js -> lib/tokens.js',
  'domain/limits.js -> lib/deep-freeze.js',
  'domain/limits.js -> lib/paging.js',
  'domain/links.js -> lib/errors.js',
  'domain/roles.js -> lib/deep-freeze.js',
  'domain/settings.js -> lib/deep-freeze.js',
  'domain/share-links.js -> lib/tokens.js',
];

function importTargets(file) {
  return importsOf(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'))
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
}

test('importsOf reads import and export specifiers, not JSDoc type imports', () => {
  const sample = [
    "import { a } from '../db/x.js';",
    "import '../side-effect.js';",
    "export { b } from './b.js';",
    "/** @param {import('../db/y.js').Row} row - Row. */",
    "const later = () => import('../lazy.js');",
  ].join('\n');
  assert.deepEqual(importsOf(sample).sort(), ['../db/x.js', '../lazy.js', '../side-effect.js', './b.js']);
});

test('no file under routes/ imports a db/ module or a service module', { skip: SKIP_SCAN }, () => {
  assert.ok(ROUTE_FILES.length > 20, 'route files are found');
  const offenders = [];
  for (const file of ROUTE_FILES) {
    for (const target of importTargets(file)) {
      if (target.startsWith('db/') || target.startsWith('services/')) offenders.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test(
  'no file under domain/ imports the media pipeline (media/), so the rules never depend on the image code',
  { skip: SKIP_SCAN },
  () => {
    const offenders = [];
    for (const file of DOMAIN_FILES) {
      for (const target of importTargets(file)) if (target.startsWith('media/')) offenders.push(`${file} -> ${target}`);
    }
    assert.deepEqual(offenders, []);
  },
);

test(
  'no file under domain/ imports db/ or services/, nor a lib/ module beyond the listed edges',
  { skip: SKIP_SCAN },
  () => {
    assert.ok(DOMAIN_FILES.includes('domain/ingest.js'), 'domain files are found');
    const layered = [];
    const lib = [];
    for (const file of DOMAIN_FILES) {
      for (const target of importTargets(file)) {
        if (target.startsWith('db/') || target.startsWith('services/')) layered.push(`${file} -> ${target}`);
        if (target.startsWith('lib/')) lib.push(`${file} -> ${target}`);
      }
    }
    assert.deepEqual(layered, []);
    assert.deepEqual(lib.sort(), DOMAIN_LIB_EDGES);
  },
);

test(
  'no file under lib/ imports the media pipeline or an app layer (media/, domain/, db/, services/, routes/, app/, config/)',
  { skip: SKIP_SCAN },
  () => {
    assert.ok(LIB_FILES.length > 10, 'lib files are found');
    const offenders = [];
    for (const file of LIB_FILES) {
      for (const target of importTargets(file)) {
        if (/^(media|domain|db|services|routes|app|config)\//.test(target)) offenders.push(`${file} -> ${target}`);
      }
    }
    assert.deepEqual(offenders, []);
  },
);

test(
  'the image and ZIP pipeline lives in media/, beside the generic helpers in lib/, and reaches no app layer',
  { skip: SKIP_SCAN },
  () => {
    const pipeline = ['image', 'image-types', 'media-store', 'strip-metadata', 'zip-intake', 'zip-out'];
    for (const name of pipeline) {
      assert.ok(!LIB_FILES.some((file) => file.startsWith(`lib/${name}.`) || file.startsWith(`lib/${name}/`)), name);
      assert.ok(
        MEDIA_FILES.some((file) => file.startsWith(`media/${name}.`) || file.startsWith(`media/${name}/`)),
        name,
      );
    }
    const offenders = [];
    for (const file of MEDIA_FILES) {
      for (const target of importTargets(file)) {
        if (/^(domain|db|services|routes|app|config)\//.test(target)) offenders.push(`${file} -> ${target}`);
      }
    }
    assert.deepEqual(offenders, []);
  },
);

test('no router calls the galleries service reads that skip the access check', { skip: SKIP_SCAN }, () => {
  const offenders = [];
  for (const file of ROUTE_FILES) {
    const source = withoutComments(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'));
    for (const match of source.matchAll(/galleriesService\s*\.\s*(imagesOf|imageByPublicName|markEdited)\b/g)) {
      offenders.push(`${file}: ${match[1]}`);
    }
    if (/\{[^}]*\b(imagesOf|imageByPublicName|markEdited)\b[^}]*\}\s*=\s*galleriesService/.test(source)) {
      offenders.push(`${file}: destructures an unchecked read`);
    }
  }
  assert.deepEqual(offenders, []);
});

test(
  'no service takes the raw database handle: transactions come through the injected runInTransaction',
  { skip: SKIP_SCAN },
  () => {
    const serviceFiles = JS_FILES.filter((file) => file.startsWith('services/'));
    assert.ok(serviceFiles.length > 10, 'service files are found');
    const offenders = [];
    for (const file of serviceFiles) {
      const code = withoutComments(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'));
      if (/\bdb\s*\.\s*(transaction|prepare|exec)\b/.test(code)) offenders.push(`${file}: uses db directly`);
      if (/export function create\w+\(\s*\{[^}]*\bdb\b/.test(code)) offenders.push(`${file}: takes db`);
    }
    assert.deepEqual(offenders, []);
  },
);

test('the app context the routers receive holds no repository but the boot-task ones', () => {
  const { context } = buildContext();
  const repositoryNames = Object.keys(createRepositories(context.db));
  const leaked = Object.keys(context.app).filter((key) => repositoryNames.includes(key));
  assert.deepEqual(leaked.sort(), BOOT_ONLY_REPOSITORIES);
  context.db.close();
});

test('domain constants are not exported from repositories', () => {
  assert.equal('INGEST_STATUS' in ingestJobsRepository, false);
  assert.equal('VIEW_KINDS' in gallerySharesRepository, false);
  assert.equal('SHARE_VIEWS_SHOWN' in gallerySharesRepository, false);
});

test('the ingest helpers are not exported from the ingest service module', () => {
  for (const name of ['skippedCounts', 'zipEntryLabel', 'MAX_SKIPPED_LISTED', 'INGEST_STATUS']) {
    assert.equal(name in ingestServiceModule, false, name);
  }
});
