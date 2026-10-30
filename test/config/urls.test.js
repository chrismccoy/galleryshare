import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_PREFIX, ADMIN_ROUTES, PATHS, PATH_TO, ROUTES } from '../../config/urls.js';
import { NAV_GROUPS } from '../../config/navigation.js';
import { PROJECT_ROOT } from '../../config/root.js';
import { APP_LOCALS } from '../../routes/view/app-locals.js';
import { startApp } from '../helpers/http.js';

let app;
let admin;
let user;
before(async () => {
  app = await startApp({ RATE_LIMIT_PUBLIC_FORM_MAX: '100' });
  admin = await app.signedIn({ role: 'admin' });
  user = await app.signedIn({ role: 'user' });
});
after(() => app.close());

const REACH = {
  front: { as: 'user', url: PATHS.front },
  login: { as: 'anonymous', url: PATHS.login },
  logout: { as: 'user', method: 'POST', url: PATHS.logout },
  account: { as: 'user', url: PATHS.account },
  accountPassword: { as: 'user', method: 'POST', url: PATHS.accountPassword },
  dashboard: { as: 'user', url: PATHS.dashboard },
  galleries: { as: 'user', url: PATHS.galleries },
  newGallery: { as: 'user', url: PATHS.newGallery },
  newGalleryUpload: null,
  activity: { as: 'user', url: PATHS.activity },
  trash: { as: 'user', url: PATHS.trash },
  trashEmpty: { as: 'user', method: 'POST', url: PATHS.trashEmpty },
  ingestJobs: null,
  media: null,
  share: () => {
    const galleryId = app.context.galleries.insert({ userId: user.user.id });
    const { token } = app.context.sharesService.share(user.user, galleryId);
    return { as: 'anonymous', url: PATH_TO.share(token) };
  },
  invite: () => {
    const { token } = app.context.invitesService.create({ role: 'user', createdBy: admin.user.id });
    return { as: 'anonymous', url: `${PATHS.invite}/${token}` };
  },
  reset: () => {
    const { token } = app.context.resetService.issue(user.user.id, admin.user.id);
    return { as: 'anonymous', url: `${PATHS.reset}/${token}` };
  },
  admin: null,
};

const REACH_ADMIN = {
  overview: PATHS.admin.overview,
  users: () => `${PATHS.admin.users}/${user.user.id}`,
  invites: PATHS.admin.invites,
  galleries: PATHS.admin.galleries,
  shares: PATHS.admin.shares,
  activity: PATHS.admin.activity,
  settings: PATHS.admin.settings,
};

const resolve = (rule) => (typeof rule === 'function' ? rule() : rule);

function reach({ as, method = 'GET', url }) {
  if (as === 'anonymous') return app.request(url, { method });
  const session = as === 'admin' ? admin : user;
  return app.request(url, { method, cookie: session.cookie, headers: { accept: 'text/html' } });
}

test('every PATHS entry has a reach rule, and every admin path is the prefix plus its relative route', () => {
  assert.deepEqual(Object.keys(REACH).sort(), Object.keys(PATHS).sort());
  assert.deepEqual(Object.keys(REACH_ADMIN).sort(), Object.keys(ADMIN_ROUTES).sort());
  assert.deepEqual(Object.keys(PATHS.admin).sort(), Object.keys(ADMIN_ROUTES).sort());
  assert.equal(PATHS.admin.overview, ADMIN_PREFIX);
  for (const [key, route] of Object.entries(ADMIN_ROUTES)) {
    if (route !== '/') assert.equal(PATHS.admin[key], `${ADMIN_PREFIX}${route}`, key);
  }
  assert.equal(APP_LOCALS.paths, PATHS, 'views read the same object');
});

test('PATH_TO builds each id and token URL from its PATHS prefix', () => {
  assert.equal(PATH_TO.gallery(7), `${PATHS.galleries}/7`);
  assert.equal(PATH_TO.gallery(7, 'edit'), `${PATHS.galleries}/7/edit`);
  assert.equal(PATH_TO.ingestJob(3), `${PATHS.ingestJobs}/3`);
  assert.equal(PATH_TO.trashItem(7, 'purge'), `${PATHS.trash}/7/purge`);
  assert.equal(PATHS.trashEmpty, `${PATHS.trash}/empty`);
  assert.equal(PATH_TO.galleryImage(7, 12), `${PATHS.galleries}/7/images/12`);
  assert.equal(PATH_TO.galleryImage(7, 12, 'remove'), `${PATHS.galleries}/7/images/12/remove`);
  assert.equal(PATH_TO.media(12, 'thumb'), `${PATHS.media}/12/thumb`);
  assert.equal(PATH_TO.gallery('a/b'), `${PATHS.galleries}/a%2Fb`, 'an id is encoded like a token');
  assert.equal(PATH_TO.galleryImage('1?x', '2#y', 'remove'), `${PATHS.galleries}/1%3Fx/images/2%23y/remove`);
  assert.equal(PATH_TO.media('../x', 'web'), `${PATHS.media}/..%2Fx/web`);
  assert.equal(PATH_TO.adminUser(5), `${PATHS.admin.users}/5`);
  assert.equal(PATH_TO.adminUser(5, 'reset-link'), `${PATHS.admin.users}/5/reset-link`);
  assert.equal(PATH_TO.adminInvite(2, 'revoke'), `${PATHS.admin.invites}/2/revoke`);
  assert.equal(PATH_TO.adminShare(4, 'revoke'), `${PATHS.admin.shares}/4/revoke`);
  assert.equal(PATH_TO.share('abc_-1'), `${PATHS.share}/abc_-1`);
  assert.equal(
    PATH_TO.shareImage('aB3dE5f', 'k3Rf9Qa2xZ', 'thumb'),
    `${PATHS.share}/aB3dE5f/i/k3Rf9Qa2xZ-thumb.webp`,
    'ends in .webp, so forums take it as an image',
  );
  assert.equal(PATH_TO.shareImage('aB3dE5f', 'k3Rf9Qa2xZ', 'web'), `${PATHS.share}/aB3dE5f/i/k3Rf9Qa2xZ.webp`);
  assert.equal(PATH_TO.shareZip('aB3dE5f'), `${PATHS.share}/aB3dE5f/zip`);
  assert.equal(PATH_TO.invite('a/b?c'), `${PATHS.invite}/a%2Fb%3Fc`, 'a token from the URL is encoded');
  assert.equal(PATH_TO.reset('tok'), `${PATHS.reset}/tok`);
  assert.equal(PATH_TO.asset('css/app.css'), '/css/app.css');
  assert.equal(APP_LOCALS.pathTo, PATH_TO, 'views read the same builders');
});

test('every asset a page links through PATH_TO.asset answers, and no view writes an asset path itself', async () => {
  const res = await app.request(PATHS.login);
  const html = await res.text();
  const assets = [...html.matchAll(/(?:href|src)="(\/(?:css|js|vendor|favicon)[^"]*)"/g)].map((m) => m[1]);
  for (const file of ['favicon.svg', 'vendor/fontawesome/css/all.min.css', 'css/app.css']) {
    assert.ok(assets.includes(PATH_TO.asset(file)), file);
  }
  for (const url of [...assets, PATH_TO.asset('js/lightbox.js')]) {
    const asset = await app.request(url);
    await asset.arrayBuffer();
    assert.equal(asset.status, 200, url);
  }
  const views = fs.readdirSync(path.join(PROJECT_ROOT, 'views'), { recursive: true }).filter((f) => f.endsWith('.ejs'));
  for (const view of views) {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'views', view), 'utf8');
    assert.doesNotMatch(source, /(?:href|src)="\/(?:css|js|vendor|favicon)/, view);
  }
});

test('the gallery paths match the design', () => {
  assert.equal(PATHS.galleries, '/dashboard/galleries');
  assert.equal(PATHS.newGallery, '/dashboard/galleries/new');
  assert.equal(PATHS.newGalleryUpload, '/dashboard/galleries/new/upload');
  assert.equal(ROUTES.galleryUpload, '/dashboard/galleries/:id/upload');
  assert.equal(ROUTES.galleryMeta, '/dashboard/galleries/:id/meta');
  assert.equal(PATHS.ingestJobs, '/dashboard/galleries/jobs');
  assert.equal(PATHS.trash, '/dashboard/trash');
  assert.equal(PATHS.media, '/media');
  assert.equal(PATHS.share, '/s');
  assert.equal(PATHS.admin.galleries, '/admin/galleries');
});

test('every PATH_TO link the pages use answers, not 404', async () => {
  for (const [as, url] of [
    ['admin', PATH_TO.adminUser(user.user.id)],
    ['admin', PATH_TO.adminUser(user.user.id, 'delete')],
  ]) {
    const res = await reach({ as, url });
    await res.arrayBuffer();
    assert.equal(res.status, 200, url);
  }
});

test('every path and prefix answers, not 404, for the role that uses it', async () => {
  for (const [key, rule] of Object.entries(REACH)) {
    const target = resolve(rule);
    if (!target) continue;
    const res = await reach(target);
    await res.arrayBuffer();
    assert.notEqual(res.status, 404, `${key}: ${target.method ?? 'GET'} ${target.url}`);
    assert.ok(res.status < 500, `${key}: ${res.status}`);
  }
  for (const [key, rule] of Object.entries(REACH_ADMIN)) {
    const url = resolve(rule);
    const res = await reach({ as: 'admin', url });
    await res.arrayBuffer();
    assert.equal(res.status, 200, `admin ${key}: ${url}`);
  }
});

test('admin paths are 404 for a regular user', async () => {
  for (const rule of Object.values(REACH_ADMIN)) {
    const url = resolve(rule);
    const res = await reach({ as: 'user', url });
    await res.arrayBuffer();
    assert.equal(res.status, 404, url);
  }
});

test('every sidebar link answers 200 for the role that sees it', async () => {
  for (const group of NAV_GROUPS) {
    for (const link of group.links) {
      const res = await reach({ as: group.admin ? 'admin' : 'user', url: link.href });
      await res.arrayBuffer();
      assert.equal(res.status, 200, `${link.key}: ${link.href}`);
    }
  }
});

function ejsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ejsFiles(full);
    return entry.name.endsWith('.ejs') ? [full] : [];
  });
}

test('views take app page paths from `paths`, not from literals', () => {
  const literal = /["'`]\/(?:$|["'`?]|admin|dashboard|account|login|logout|s\/|invite|reset)/;
  const offenders = [];
  for (const file of ejsFiles(path.join(PROJECT_ROOT, 'views'))) {
    const code = fs.readFileSync(file, 'utf8').replace(/<%#[\s\S]*?%>/g, (comment) => comment.replace(/[^\n]/g, ''));
    code.split('\n').forEach((line, i) => {
      if (literal.test(line)) offenders.push(`${path.relative(PROJECT_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('PATH_TO.login returns to a page after signing in, and is the plain sign-in path otherwise', () => {
  assert.equal(PATH_TO.login(), PATHS.login);
  assert.equal(PATH_TO.login(PATHS.front), PATHS.login);
  assert.equal(PATH_TO.login('/dashboard/galleries?x=1'), `${PATHS.login}?next=%2Fdashboard%2Fgalleries%3Fx%3D1`);
});
