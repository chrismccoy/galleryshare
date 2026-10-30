import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { PROJECT_ROOT } from '../../config/root.js';
import { NO_GIT_REASON, projectFiles } from '../helpers/project-files.js';
import { appRoutes } from '../helpers/express-routes.js';
import { ADMIN_ITEM_ROUTES, ADMIN_ROUTES, PATHS, ROUTES } from '../../config/urls.js';

const ROUTE_FILES = (projectFiles({ untracked: true }) ?? []).filter(
  (file) => file.startsWith('routes/') && file.endsWith('.js'),
);

const SKIP_SCAN = ROUTE_FILES.length === 0 && NO_GIT_REASON;

const RENDERERS = new Set([
  'renderInShell',
  'renderPublic',
  'notFound',
  'orNotFound',
  'withFormErrors',
  'render',
  'rerender',
  'renderEdit',
  'renderNew',
  'renderUser',
  'unavailable',
  'tooManyPage',
]);

function calleeName(call) {
  return call.callee.type === 'Identifier' ? call.callee.name : null;
}

function droppedRenderCalls(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const lines = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression') {
      if (RENDERERS.has(calleeName(node.expression))) lines.push(node.loc.start.line);
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'loc') visit(value);
    return undefined;
  };
  visit(ast);
  return lines;
}

test('routes/ keeps only the wiring at its top level; middleware, view helpers and pages have their own folders', () => {
  const topLevel = fs.readdirSync(path.join(PROJECT_ROOT, 'routes')).sort();
  assert.deepEqual(topLevel, ['index.js', 'middleware', 'pages', 'view']);
});

test(
  'style: route handlers return the result of a render helper instead of calling it as a bare statement',
  { skip: SKIP_SCAN },
  () => {
    assert.ok(ROUTE_FILES.length > 20, `found ${ROUTE_FILES.length} route files`);
    const offenders = [];
    for (const file of ROUTE_FILES) {
      const source = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
      for (const line of droppedRenderCalls(source)) offenders.push(`${file}:${line}`);
    }
    assert.deepEqual(offenders, [], 'write `return renderInShell(...)`, as the other handlers do');
  },
);

test('the guard catches a dropped render call and accepts a returned or awaited one', () => {
  const dropped = 'function h(res) {\n  renderInShell(res, "v", {});\n}\n';
  assert.deepEqual(droppedRenderCalls(dropped), [2]);
  const kept = [
    'function a(res) { return renderInShell(res, "v", {}); }',
    'const b = (res) => renderPublic(res, "v", {});',
    'async function c(res) { await notFound(res); }',
  ].join('\n');
  assert.deepEqual(droppedRenderCalls(kept), []);
});

test(
  'no file under routes/ holds Tailwind colour or Font Awesome class strings; the views map names to classes',
  { skip: SKIP_SCAN },
  () => {
    const CLASS_STRING = /['"`][^'"`]*\b(?:fa-(?:solid|regular|brands)|(?:bg|text|border)-[a-z]+-\d{2,3})\b/;
    const offenders = ROUTE_FILES.filter((file) =>
      CLASS_STRING.test(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8')),
    );
    assert.deepEqual(offenders, []);
  },
);

const methodRoutes = () => appRoutes().map((route) => `${route.method} ${route.path}`);

test('the gallery page routes keep their methods and paths, and the fixed paths come before /:id', () => {
  const routes = methodRoutes().filter((r) => r.includes(`${PATHS.galleries}/`));
  assert.deepEqual(
    [...routes].sort(),
    [
      'GET /dashboard/galleries/new',
      'POST /dashboard/galleries/new/upload',
      'GET /dashboard/galleries/jobs/:id',
      'GET /dashboard/galleries/:id',
      'POST /dashboard/galleries/:id/meta',
      'POST /dashboard/galleries/:id/images/:imageId/remove',
      'POST /dashboard/galleries/:id/share',
      'POST /dashboard/galleries/:id/unshare',
      'POST /dashboard/galleries/:id/delete',
      'POST /dashboard/galleries/:id/reorder',
      'POST /dashboard/galleries/:id/upload',
    ].sort(),
  );
  const editView = routes.indexOf('GET /dashboard/galleries/:id');
  for (const fixed of ['GET /dashboard/galleries/new', 'GET /dashboard/galleries/jobs/:id']) {
    assert.ok(routes.indexOf(fixed) < editView, `${fixed} is registered before the edit view`);
  }
});

test('the Activity pages are GET routes at /dashboard/activity and (inside the admin router) /activity', () => {
  const routes = methodRoutes().filter((r) => r.includes('activity'));
  assert.deepEqual(routes.sort(), [`GET ${PATHS.activity}`, `GET ${ADMIN_ROUTES.activity}`].sort());
});

test('every route with an id or token is a ROUTES or ADMIN_ITEM_ROUTES pattern, and every pattern is routed', () => {
  const routed = new Set(
    methodRoutes()
      .map((route) => route.split(' ')[1])
      .filter((route) => route.includes('/:')),
  );
  const declared = new Set([...Object.values(ROUTES), ...Object.values(ADMIN_ITEM_ROUTES)]);
  assert.deepEqual([...routed].sort(), [...declared].sort());
});
