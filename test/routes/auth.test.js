import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, cookiesFrom, setCookieLine, csrfFromHtml } from '../helpers/http.js';
import { TEST_PASSWORD } from '../helpers/constants.js';
import { MIN_PASSWORD_LENGTH } from '../../domain/limits.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { activityLog } from '../helpers/activity.js';
import { assertSignInRedirect } from '../helpers/assertions.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('GET / while signed out redirects to /login with 303', async () => {
  const res = await app.request('/');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), PATHS.login);
});

test('a deeper page while signed out keeps the path in next', async () => {
  const res = await app.request(PATHS.account);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${PATHS.login}?next=%2Faccount`);
});

test('a signed-out POST redirects to plain /login, without a next it could not replay', async () => {
  const { res } = await app.postAnonymous(PATHS.accountPassword, { password: 'x' }, { pagePath: PATHS.login });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), PATHS.login);
});

test('correct credentials: 303 to / and an httpOnly, SameSite=Lax sid cookie', async () => {
  const user = await app.createUser({ email: 'right@example.com' });
  const { res } = await app.postAnonymous(PATHS.login, { email: 'RIGHT@example.com ', password: TEST_PASSWORD });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const line = setCookieLine(res, 'sid');
  assert.ok(line, 'sid cookie set');
  assert.match(line, /HttpOnly/i);
  assert.match(line, /SameSite=Lax/i);
  assert.match(line, /Path=\//);
  assert.doesNotMatch(line, /Secure/i, 'not Secure outside production');
  const sid = cookiesFrom(res).sid;
  assert.equal(app.context.sessions.liveByToken(sid).user_id, user.id);

  const root = await app.request('/', { cookie: `sid=${sid}` });
  assert.equal(root.headers.get('location'), PATHS.dashboard);
  const home = await app.request(PATHS.dashboard, { cookie: `sid=${sid}` });
  assert.equal(home.status, 200);
});

test('login honours a safe next path and ignores an off-site one', async () => {
  await app.createUser({ email: 'next@example.com' });
  const { res: ok } = await app.postAnonymous(
    `${PATHS.login}?next=%2Faccount`,
    { email: 'next@example.com', password: TEST_PASSWORD },
    { pagePath: `${PATHS.login}?next=%2Faccount` },
  );
  assert.equal(ok.headers.get('location'), PATHS.account);
  const { res: bad } = await app.postAnonymous(
    `${PATHS.login}?next=%2F%2Fevil.example`,
    { email: 'next@example.com', password: TEST_PASSWORD },
    { pagePath: PATHS.login },
  );
  assert.equal(bad.headers.get('location'), '/');
});

test('wrong credentials: 400 with the copy and no session cookie', async () => {
  await app.createUser({ email: 'wrong@example.com' });
  for (const form of [
    { email: 'wrong@example.com', password: 'not the password' },
    { email: 'nobody@example.com', password: TEST_PASSWORD },
  ]) {
    const { res, html } = await app.postAnonymous(PATHS.login, form);
    assert.equal(res.status, 400);
    assert.equal(setCookieLine(res, 'sid'), undefined);
    assert.match(html, /Incorrect email or password\./);
  }
});

test('a disabled account cannot sign in', async () => {
  const user = await app.createUser({ email: 'off@example.com' });
  app.context.users.setDisabled(user.id, true);
  const { res } = await app.postAnonymous(PATHS.login, { email: 'off@example.com', password: TEST_PASSWORD });
  assert.equal(res.status, 400);
  assert.equal(setCookieLine(res, 'sid'), undefined);
});

test('the login attempt after the per-window limit (the 11th by default) is refused with 429 and the page copy', async () => {
  const { cookie, csrf } = await app.anonymous(PATHS.login);
  const form = { email: 'flood@example.com', password: 'whatever whatever' };
  const max = app.context.config.rateLimit.publicFormMax;
  assert.equal(max, 10, 'the default public form limit');
  for (let i = 0; i < max; i++) {
    const res = await app.request(PATHS.login, { form, cookie, csrf });
    assert.equal(res.status, 400, `attempt ${i + 1}`);
  }
  const res = await app.request(PATHS.login, { form, cookie, csrf });
  assert.equal(res.status, 429);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Too many attempts\. Try again in a few minutes\./);
});

test('POST /login without the anonymous CSRF token is refused with 403', async () => {
  await app.createUser({ email: 'nocsrf@example.com' });
  const { cookie } = await app.anonymous(PATHS.login);
  const missing = await app.request(PATHS.login, {
    form: { email: 'nocsrf@example.com', password: TEST_PASSWORD },
    cookie,
  });
  assert.equal(missing.status, 403);
  assert.equal(setCookieLine(missing, 'sid'), undefined);
  const { csrf } = await app.anonymous(PATHS.login);
  const noCookie = await app.request(PATHS.login, {
    form: { email: 'nocsrf@example.com', password: TEST_PASSWORD },
    csrf,
  });
  assert.equal(noCookie.status, 403);
});

test('logout is a CSRF-checked POST that ends the session', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);
  const refused = await app.request(PATHS.logout, { method: 'POST', cookie });
  assert.equal(refused.status, 403);

  const res = await app.request(PATHS.logout, { cookie, csrf });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), PATHS.login);
  assert.match(setCookieLine(res, 'sid'), /Expires=Thu, 01 Jan 1970/);
  const after = await app.request('/', { cookie });
  assert.equal(after.status, 303);
});

test('POST /account/password without _csrf is 403 and changes nothing', async () => {
  const user = await app.createUser();
  const { cookie } = await app.login(user.email);
  const res = await app.request(PATHS.accountPassword, {
    form: { current: TEST_PASSWORD, next: 'a brand new password' },
    cookie,
  });
  assert.equal(res.status, 403);
  await app.login(user.email);
});

test('POST /account/password changes the password, ends other sessions, keeps this browser signed in', async () => {
  const user = await app.createUser();
  const other = await app.login(user.email);
  const mine = await app.login(user.email);

  const page = await app.request(PATHS.account, { cookie: mine.cookie });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="current"/);

  const res = await app.request(PATHS.accountPassword, {
    form: { current: TEST_PASSWORD, next: 'a brand new password' },
    cookie: mine.cookie,
    csrf: mine.csrf,
  });
  assert.equal(res.status, 303, 'POST/redirect/GET: a refresh does not re-post the form');
  assert.equal(res.headers.get('location'), `${PATHS.account}?notice=changed`);
  const fresh = cookiesFrom(res).sid;
  assert.ok(fresh, 'a fresh session cookie is issued');
  assert.notEqual(`sid=${fresh}`, mine.cookie);

  assert.equal((await app.request(PATHS.account, { cookie: other.cookie })).status, 303);
  assert.equal((await app.request(PATHS.account, { cookie: mine.cookie })).status, 303);
  const after = await app.request(`${PATHS.account}?notice=changed`, { cookie: `sid=${fresh}` });
  assert.equal(after.status, 200);
  assert.match(await after.text(), /Password changed\./);
  await app.login(user.email, 'a brand new password');
});

test('POST /account/password with a wrong current or short new password shows the reason', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);
  const wrong = await app.request(PATHS.accountPassword, {
    form: { current: 'nope nope nope', next: 'a brand new password' },
    cookie,
    csrf,
  });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /Your current password is incorrect\./);
  const short = await app.request(PATHS.accountPassword, {
    form: { current: TEST_PASSWORD, next: 'short' },
    cookie,
    csrf,
  });
  assert.equal(short.status, 400);
  assert.match(await short.text(), new RegExp(`Password must be at least ${MIN_PASSWORD_LENGTH} characters\\.`));
  await app.login(user.email);
});

test('a signed-in non-admin gets 404 for /admin, the same page as any unknown path', async () => {
  const user = await app.createUser();
  const { cookie } = await app.login(user.email);
  const admin = await app.request(PATHS.admin.overview, { cookie });
  assert.equal(admin.status, 404);
  const sub = await app.request(PATHS.admin.users, { cookie });
  assert.equal(sub.status, 404);
  const unknown = await app.request('/no-such-page', { cookie });
  assert.equal(unknown.status, 404);
  assert.match(await admin.text(), /Page not found/);
});

test('/admin while signed out redirects to sign in', async () => {
  await assertSignInRedirect(app, PATHS.admin.overview);
});

test('the sidebar shows admin links to admins only', async () => {
  const user = await app.createUser();
  const admin = await app.createUser({ role: 'admin' });
  const userPage = await (await app.request(PATHS.account, { cookie: (await app.login(user.email)).cookie })).text();
  const adminPage = await (await app.request(PATHS.account, { cookie: (await app.login(admin.email)).cookie })).text();
  assert.doesNotMatch(userPage, /href="\/admin\/settings"/);
  assert.match(adminPage, /href="\/admin\/settings"/);
  assert.match(userPage, /href="\/dashboard\/galleries"/);
  assert.match(userPage, /GalleryShare/);
});

test('/invite/<bad> shows 200 with the invalid-link copy and no form', async () => {
  const res = await app.request(PATH_TO.invite('not-a-real-token'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /This invite link is not valid\./);
  assert.doesNotMatch(html, /name="password"/);
});

test('a valid invite form post creates the account, signs in and redirects to /', async () => {
  const admin = await app.createUser({ role: 'admin' });
  const { token } = app.context.invitesService.create({ role: 'user', label: 'for Bob', createdBy: admin.id });

  const page = await app.request(PATH_TO.invite(token));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /name="display_name"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);

  const { res } = await app.postAnonymous(PATH_TO.invite(token), {
    display_name: 'Bob',
    email: 'bob@example.com',
    password: 'bobs long password',
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const sid = cookiesFrom(res).sid;
  const bob = app.context.users.byEmail('bob@example.com');
  assert.equal(bob.display_name, 'Bob');
  assert.equal(bob.role, 'user');
  assert.equal(app.context.sessions.liveByToken(sid).user_id, bob.id);

  const again = await app.request(PATH_TO.invite(token));
  assert.match(await again.text(), /This invite link has already been used\./);
});

test('an invite form post normalizes the email once for both redeem and sign-in', async (t) => {
  const admin = await app.createUser({ role: 'admin' });
  const { token } = app.context.invitesService.create({ role: 'user', createdBy: admin.id });
  const redeem = t.mock.method(app.context.invitesService, 'redeem');
  const signIn = t.mock.method(app.context.authService, 'signIn');

  const { res } = await app.postAnonymous(PATH_TO.invite(token), {
    display_name: 'Cleo',
    email: '  Cleo@Example.COM ',
    password: 'cleos long password',
  });
  assert.equal(res.status, 303);
  assert.equal(redeem.mock.calls[0].arguments[1].email, 'cleo@example.com');
  assert.equal(signIn.mock.calls[0].arguments[0], 'cleo@example.com');
});

test('an invite form post with a short password re-shows the form with the reason', async () => {
  const admin = await app.createUser({ role: 'admin' });
  const { token } = app.context.invitesService.create({ role: 'user', createdBy: admin.id });
  const { res, html } = await app.postAnonymous(PATH_TO.invite(token), {
    display_name: 'Cy',
    email: 'cy@example.com',
    password: 'short',
  });
  assert.equal(res.status, 400);
  assert.match(html, new RegExp(`Password must be at least ${MIN_PASSWORD_LENGTH} characters\\.`));
  assert.match(html, /value="cy@example.com"/);
  assert.equal(app.context.users.byEmail('cy@example.com'), null);
  assert.equal(app.context.invitesService.problemForToken(token), null, 'invite still usable');
});

test('/reset/<token> sets the password, ends sessions and sends the user to sign in', async () => {
  const admin = await app.createUser({ role: 'admin' });
  const user = await app.createUser();
  const old = await app.login(user.email);
  const { token } = app.context.resetService.issue(user.id, admin.id);

  const page = await app.request(PATH_TO.reset(token));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="password"/);

  const { res } = await app.postAnonymous(PATH_TO.reset(token), { password: 'the reset password' });
  assert.equal(res.status, 303);
  const location = res.headers.get('location');
  assert.match(location, /^\/login/);
  const notice = await app.request(location);
  assert.match(await notice.text(), /Password updated\. Sign in with your new password\./);

  assert.equal((await app.request(PATHS.account, { cookie: old.cookie })).status, 303);
  await app.login(user.email, 'the reset password');

  const used = await app.request(PATH_TO.reset(token));
  assert.equal(used.status, 200);
  assert.match(await used.text(), /This reset link has already been used\./);
});

test('/reset/<bad> shows the invalid-link copy', async () => {
  const res = await app.request(PATH_TO.reset('nope'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /This reset link is not valid\./);
  assert.doesNotMatch(html, /name="password"/);
});

test('GET /login when signed in goes to /', async () => {
  const user = await app.createUser();
  const { cookie } = await app.login(user.email);
  const res = await app.request(PATHS.login, { cookie });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
});

test('the login form carries the anonymous token', async () => {
  const { html, cookie } = await app.anonymous(PATHS.login);
  assert.ok(cookie);
  assert.ok(csrfFromHtml(html));
});

const eventsOf = (kind) => activityLog(app.context, { kinds: [kind] });

test('signing in records signedIn with the address and browser; a wrong password records signInFailed with the email only', async () => {
  const user = await app.createUser({ email: 'log-me@example.com' });
  const { cookie, csrf } = await app.anonymous(PATHS.login);
  const agent = 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/120.0';
  const bad = await app.request(PATHS.login, {
    form: { email: ' Log-Me@Example.com ', password: 'not-the-password-xyz' },
    cookie,
    csrf,
    headers: { 'user-agent': agent },
  });
  assert.equal(bad.status, 400);
  const failed = eventsOf('signInFailed').at(-1);
  assert.equal(failed.area, 'security');
  assert.equal(failed.actor_type, 'visitor');
  assert.equal(failed.details, 'log-me@example.com');
  assert.ok(failed.ip);
  assert.equal(failed.user_agent, agent);
  assert.ok(!JSON.stringify(failed).includes('not-the-password-xyz'), 'the password is never stored');

  const ok = await app.request(PATHS.login, {
    form: { email: 'log-me@example.com', password: TEST_PASSWORD },
    cookie,
    csrf,
    headers: { 'user-agent': agent },
  });
  assert.equal(ok.status, 303);
  const row = eventsOf('signedIn').find((r) => r.actor_id === user.id);
  assert.equal(row.area, 'accounts');
  assert.equal(row.actor_type, 'user');
  assert.ok(row.ip);
  assert.equal(row.user_agent, agent);
});

test('signing out records signedOut for the user; a logout with no session records nothing', async () => {
  const user = await app.createUser();
  const { cookie, csrf } = await app.login(user.email);
  await app.request(PATHS.logout, { cookie, csrf });
  assert.equal(eventsOf('signedOut').filter((r) => r.actor_id === user.id).length, 1);
  const before = app.context.activity.list({ limit: 200 }).length;
  const anon = await app.anonymous(PATHS.login);
  await app.request(PATHS.logout, { cookie: anon.cookie, csrf: anon.csrf });
  assert.equal(app.context.activity.list({ limit: 200 }).length, before);
});

test('changing the password records passwordChanged but no signedIn for the automatic sign-in after it', async () => {
  const user = await app.createUser();
  const session = await app.login(user.email);
  const signedInBefore = eventsOf('signedIn').filter((r) => r.actor_id === user.id).length;
  const { res } = await session.post(PATHS.accountPassword, {
    current: TEST_PASSWORD,
    next: 'a-brand-new-password',
  });
  assert.equal(res.status, 303);
  assert.equal(eventsOf('passwordChanged').filter((r) => r.actor_id === user.id).length, 1);
  assert.equal(eventsOf('signedIn').filter((r) => r.actor_id === user.id).length, signedInBefore);
});

test('the refused sign-in attempt records rateLimitHit named "sign-in form"', async () => {
  const { cookie, csrf } = await app.anonymous(PATHS.login);
  const form = { email: 'flood-log@example.com', password: 'whatever whatever' };
  const max = app.context.config.rateLimit.publicFormMax;
  for (let i = 0; i <= max; i++) await app.request(PATHS.login, { form, cookie, csrf });
  const hit = eventsOf('rateLimitHit').find((r) => r.details === 'sign-in form');
  assert.equal(hit.area, 'security');
  assert.equal(hit.actor_type, 'visitor');
  assert.ok(hit.ip);
});
