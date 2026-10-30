import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen, startApp, withApp, cookiesFrom, setCookieLine } from '../helpers/http.js';
import { imageRow } from '../helpers/gallery-seed.js';
import { TEST_PASSWORD } from '../helpers/constants.js';
import { requireUser, requireAdmin } from '../../routes/middleware/guards.js';
import { publicFiles } from '../../routes/middleware/static-files.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>/i;
const INLINE_HANDLER = /\son[a-z]+\s*=/i;
const INLINE_STYLE = /\sstyle\s*=/i;

function assertSafeHtml(res, html, label) {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self'/, `${label}: CSP`);
  assert.match(csp, /frame-ancestors 'none'/, `${label}: CSP frame-ancestors`);
  assert.doesNotMatch(csp, /unsafe-inline/, `${label}: no unsafe-inline`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY', `${label}: frame options`);
  assert.doesNotMatch(html, INLINE_SCRIPT, `${label}: inline <script>`);
  assert.doesNotMatch(html, INLINE_HANDLER, `${label}: inline event handler`);
  assert.doesNotMatch(html, INLINE_STYLE, `${label}: inline style attribute`);
}

test('every rendered page has the CSP and no inline script, handler or style', async () => {
  const user = await app.createUser();
  const admin = await app.createUser({ role: 'admin' });
  const { token: invite } = app.context.invitesService.create({ role: 'user', createdBy: admin.id });
  const { token: reset } = app.context.resetService.issue(user.id, admin.id);
  const signedIn = await app.login(user.email);
  const adminIn = await app.login(admin.email);
  const galleryId = app.context.galleries.insert({ userId: user.id });
  const jobId = app.context.ingestJobs.insert({ userId: user.id, galleryId, total: 2 });
  const shareOf = (images) => {
    const id = app.context.galleries.insert({ userId: user.id });
    for (let n = 0; n < images; n++) {
      app.context.galleryImages.insert(imageRow(id, { n, bytesOrig: 1, bytesWeb: 1, bytesThumb: 1 }));
    }
    app.context.galleriesService.saveEdits(user, id, { meta: { allowZip: true }, images: [] });
    return PATH_TO.share(app.context.sharesService.share(user, id).token);
  };
  const sharedGrid = shareOf(3);
  const sharedSingle = shareOf(1);
  const sharedEmpty = shareOf(0);

  const pages = [
    [PATHS.login, undefined, 200],
    [`${PATHS.login}?notice=reset`, undefined, 200],
    [PATH_TO.invite(invite), undefined, 200],
    [PATH_TO.invite('bad'), undefined, 200],
    [PATH_TO.reset(reset), undefined, 200],
    [PATH_TO.reset('bad'), undefined, 200],
    [PATHS.dashboard, signedIn.cookie, 200],
    [PATHS.account, signedIn.cookie, 200],
    [PATHS.account, adminIn.cookie, 200],
    [PATHS.admin.overview, signedIn.cookie, 404],
    ['/nowhere', signedIn.cookie, 404],
    [PATHS.newGallery, signedIn.cookie, 200],
    [PATH_TO.gallery(galleryId), signedIn.cookie, 200],
    [PATH_TO.gallery(galleryId), adminIn.cookie, 200],
    [PATH_TO.ingestJob(jobId), signedIn.cookie, 200],
    [sharedGrid, undefined, 200],
    [sharedSingle, undefined, 200],
    [sharedEmpty, undefined, 200],
    [PATH_TO.share('Zz9Zz9Z'), undefined, 404],
  ];
  for (const [path, cookie, status] of pages) {
    const res = await app.request(path, { cookie });
    assert.equal(res.status, status, path);
    assert.match(res.headers.get('content-type'), /text\/html/, path);
    assertSafeHtml(res, await res.text(), path);
  }

  const posts = [
    [PATHS.login, { email: user.email, password: 'wrong wrong wrong' }],
    [PATH_TO.invite('bad'), { display_name: 'X', email: 'x@example.com', password: 'long enough pw' }],
  ];
  for (const [path, form] of posts) {
    const { res, html } = await app.postAnonymous(path, form, { pagePath: PATHS.login });
    assert.equal(res.status, 400, path);
    assertSafeHtml(res, html, `POST ${path}`);
  }
  const oneTime = [
    [PATHS.admin.invites, { role: 'admin', label: 'one-time' }],
    [PATH_TO.adminUser(user.id, 'reset-link'), {}],
  ];
  for (const [path, form] of oneTime) {
    const res = await app.request(path, { form, cookie: adminIn.cookie, csrf: adminIn.csrf });
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /data-one-time-link/, `${path}: shows the one-time link`);
    assertSafeHtml(res, html, `POST ${path}`);
  }

  const forbidden = await app.request(PATHS.accountPassword, { form: {}, cookie: signedIn.cookie });
  assert.equal(forbidden.status, 403);
  assertSafeHtml(forbidden, await forbidden.text(), '403 page');
});

test('the anonymous pre cookie is httpOnly, SameSite=Lax and lasts two hours', async () => {
  const res = await app.request(PATHS.login);
  const line = setCookieLine(res, 'pre');
  assert.ok(line);
  assert.match(line, /HttpOnly/i);
  assert.match(line, /SameSite=Lax/i);
  assert.match(line, /Max-Age=7200/);
});

test('a GET with a valid pre cookie reuses it instead of minting another', async () => {
  const { cookie } = await app.anonymous(PATHS.login);
  const again = await app.request(PATHS.login, { cookie });
  assert.equal(setCookieLine(again, 'pre'), undefined);
});

test('a tampered pre cookie is refused', async () => {
  await app.createUser({ email: 'tamper@example.com' });
  const { cookie, csrf } = await app.anonymous(PATHS.login);
  const [token, exp, sig] = cookie.slice('pre='.length).split('.');
  const forged = `pre=${token}.${Number(exp) + 999999}.${sig}`;
  const res = await app.request(PATHS.login, {
    form: { email: 'tamper@example.com', password: TEST_PASSWORD },
    cookie: forged,
    csrf,
  });
  assert.equal(res.status, 403);
  assert.equal(setCookieLine(res, 'sid'), undefined);
});

test("an anonymous token from one browser does not pass with another browser's cookie", async () => {
  await app.createUser({ email: 'swap@example.com' });
  const a = await app.anonymous(PATHS.login);
  const b = await app.anonymous(PATHS.login);
  const res = await app.request(PATHS.login, {
    form: { email: 'swap@example.com', password: TEST_PASSWORD },
    cookie: a.cookie,
    csrf: b.csrf,
  });
  assert.equal(res.status, 403);
});

test('the session CSRF token is accepted from the x-csrf-token header', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);
  const res = await app.request(PATHS.logout, { method: 'POST', cookie, headers: { 'x-csrf-token': csrf } });
  assert.equal(res.status, 303);
});

test("a session token does not work as another session's token", async () => {
  const a = await app.createUser();
  const b = await app.createUser();
  const sa = await app.login(a.email);
  const sb = await app.login(b.email);
  const res = await app.request(PATHS.logout, { cookie: sa.cookie, csrf: sb.csrf });
  assert.equal(res.status, 403);
});

test('a body over 64kb is refused with 413', async () => {
  const { cookie, csrf } = await app.anonymous(PATHS.login);
  const res = await app.request(PATHS.login, { form: { email: 'x'.repeat(70 * 1024), password: 'x' }, cookie, csrf });
  assert.equal(res.status, 413);
});

test('a malformed body gets plain 400 copy, never parser internals', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);
  const bad = await app.request(PATHS.accountPassword, {
    cookie,
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
  const html = await bad.text();
  assert.match(html, /That request could not be read\./);
  assert.doesNotMatch(html, /SyntaxError|JSON|at .*\.js:\d+/);
});

test('requireUser/requireAdmin: API flavour answers JSON 401 and 404', async () => {
  const mini = express();
  mini.use((req, _res, next) => {
    req.user = req.get('x-role') ? { id: 1, role: req.get('x-role') } : null;
    next();
  });
  mini.get('/u', requireUser({ api: true }), (_req, res) => res.json({ ok: true }));
  mini.get('/a', requireAdmin({ api: true }), (_req, res) => res.json({ ok: true }));
  const { url: base, close } = await listen(mini);
  try {
    assert.equal((await fetch(`${base}/u`)).status, 401);
    assert.equal((await fetch(`${base}/u`, { headers: { 'x-role': 'user' } })).status, 200);
    assert.equal((await fetch(`${base}/a`)).status, 401);
    const denied = await fetch(`${base}/a`, { headers: { 'x-role': 'user' } });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'Not found.' });
    assert.equal((await fetch(`${base}/a`, { headers: { 'x-role': 'admin' } })).status, 200);
  } finally {
    await close();
  }
});

test('a malformed :id is the 404 page on every route that takes one', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const adminRoutes = {
    get: [(id) => PATH_TO.adminUser(id), (id) => PATH_TO.adminUser(id, 'delete')],
    post: [
      (id) => PATH_TO.adminUser(id, 'reset-link'),
      (id) => PATH_TO.adminUser(id, 'disable'),
      (id) => PATH_TO.adminUser(id, 'enable'),
      (id) => PATH_TO.adminUser(id, 'role'),
      (id) => PATH_TO.adminUser(id, 'delete'),
      (id) => PATH_TO.adminInvite(id, 'revoke'),
    ],
  };
  const cases = ['abc', '0', '1.5', '007'].flatMap((bad) => [
    ...adminRoutes.get.map((pathOf) => ['GET', pathOf(bad)]),
    ...adminRoutes.post.map((pathOf) => ['POST', pathOf(bad)]),
  ]);
  for (const [method, path] of cases) {
    const { res, html } = method === 'GET' ? await app.get(admin, path) : await app.post(admin, path, {});
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.match(html, /Page not found\./, `${method} ${path}`);
  }
});

test('HSTS is only sent in production or behind a proxy', async () => {
  const res = await app.request(PATHS.login);
  assert.equal(res.headers.get('strict-transport-security'), null);
  await withApp({ TRUST_PROXY: '1' }, async (proxied) => {
    const r = await proxied.request(PATHS.login);
    assert.match(r.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(setCookieLine(r, 'pre'), /Secure/);
  });
});

test('TRUST_PROXY=0 sends no HSTS and no Secure cookies', async () => {
  await withApp({ TRUST_PROXY: '0' }, async (plain) => {
    assert.equal(plain.context.config.session.cookieSecure, false);
    const r = await plain.request(PATHS.login);
    assert.equal(r.headers.get('strict-transport-security'), null);
    assert.doesNotMatch(setCookieLine(r, 'pre'), /Secure/);
  });
});

test('a multipart POST to a non-upload route is CSRF-checked', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);

  const form = new FormData();
  form.set('x', '1');
  const logout = await app.request(PATHS.logout, { cookie, body: form });
  assert.equal(logout.status, 403);
  assert.equal((await app.request(PATHS.account, { cookie })).status, 200, 'session still valid');

  const junk = await app.request(PATHS.logout, {
    cookie,
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: 'junk',
  });
  assert.equal(junk.status, 403);

  const change = new FormData();
  change.set('current', TEST_PASSWORD);
  change.set('next', 'a brand new password');
  const pw = await app.request(PATHS.accountPassword, { cookie, body: change });
  assert.equal(pw.status, 403);
  await app.login(user.email);

  const withHeader = await app.request(PATHS.logout, { cookie, headers: { 'x-csrf-token': csrf }, body: form });
  assert.equal(withHeader.status, 303);
});

test('the session cookie is Secure behind a proxy', async () => {
  await withApp({ TRUST_PROXY: '1' }, async (proxied) => {
    await proxied.createUser({ email: 'p@example.com' });
    const { res } = await proxied.postAnonymous(PATHS.login, { email: 'p@example.com', password: TEST_PASSWORD });
    assert.equal(res.status, 303);
    assert.match(setCookieLine(res, 'sid'), /Secure/);
    assert.ok(cookiesFrom(res).sid);
  });
});

test('the screenshot gallery under /screenshots is public but marked noindex', async () => {
  const res = await app.request('/screenshots/no-such-shot.jpg');
  assert.notEqual(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  const other = await app.request(PATHS.login);
  assert.equal(other.headers.get('x-robots-tag'), null, 'other pages are not marked');
});

test('a real screenshot gallery file is served with noindex', async () => {
  const res = await app.request('/screenshots/gallery.css');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('the generic public mount never serves the screenshot gallery, so its noindex mount is the only route', async (t) => {
  const bare = express();
  bare.use(publicFiles());
  const server = await listen(bare);
  t.after(() => server.close());
  assert.equal((await fetch(`${server.url}/screenshots/gallery.css`)).status, 404);
  assert.equal((await fetch(`${server.url}/screenshots`)).status, 404);
  const script = await fetch(`${server.url}/js/reorder.js`);
  assert.equal(script.status, 200, 'other public files are still served');
});

test('an encoded or re-cased screenshot path never serves the gallery without noindex', async () => {
  for (const url of [
    '/%73creenshots/gallery.css',
    '/SCREENSHOTS/gallery.css',
    '/Screenshots/index.html',
    '/%2573creenshots/x',
  ]) {
    const res = await app.request(url);
    await res.arrayBuffer();
    assert.ok(res.status !== 200 || res.headers.get('x-robots-tag') === 'noindex, nofollow', `${url}: ${res.status}`);
  }
  const encoded = await app.request('/%73creenshots/gallery.css');
  await encoded.arrayBuffer();
  assert.notEqual(encoded.status, 200, 'the generic mount refuses the encoded gallery path');
});
