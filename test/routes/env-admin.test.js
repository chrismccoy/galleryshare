import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, startApp, withApp } from '../helpers/http.js';
import { ENV_ADMIN_MESSAGE } from '../../domain/accounts.js';
import { verifyPassword } from '../../lib/password.js';
import { ENV_ADMIN, legacyResetLink } from '../helpers/accounts.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { rowCount } from '../helpers/db.js';

const EMAIL = ENV_ADMIN.email;
const PASSWORD = ENV_ADMIN.password;
const REFUSAL = escapeHtml(ENV_ADMIN_MESSAGE);
const NOTE = 'Managed in .env';

let app;
before(async () => {
  app = await startApp({ ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD, ADMIN_NAME: 'Owner' });
});
after(() => app.close());

const owner = () => app.context.users.byEmail(EMAIL);

function otherAdmin() {
  return app.signedIn({ role: 'admin' });
}

test('the env admin exists after boot and can sign in with ADMIN_PASSWORD', async () => {
  const row = owner();
  assert.equal(row.role, 'admin');
  assert.equal(row.display_name, 'Owner');
  const session = await app.login(EMAIL, PASSWORD);
  assert.equal(session.res.headers.get('location'), '/');
  const { res, html } = await app.get(session, PATHS.admin.users);
  assert.equal(res.status, 200);
  assert.match(html, /owner@example\.com/);
});

test('the env admin user page hides disable, role, delete and reset-link without a .env note', async () => {
  const admin = await otherAdmin();
  const { res, html } = await app.get(admin, PATH_TO.adminUser(owner().id));
  assert.equal(res.status, 200);
  assert.ok(!html.includes(NOTE));
  assert.ok(!html.includes('ADMIN_PASSWORD'));
  assert.doesNotMatch(html, /\/disable"/);
  assert.doesNotMatch(html, /\/role"/);
  assert.doesNotMatch(html, /\/delete"/);
  assert.doesNotMatch(html, /\/reset-link"/);
  assert.match(html, /data-widget="profile"/);

  const plain = await app.createUser();
  const other = await app.get(admin, PATH_TO.adminUser(plain.id));
  assert.ok(!other.html.includes(NOTE));
  assert.match(other.html, /\/disable"/);
  assert.match(other.html, /\/reset-link"/);
});

test('posting disable, role, delete or reset-link for the env admin is refused with 400', async () => {
  const admin = await otherAdmin();
  const id = owner().id;
  const before = owner();
  for (const [path, form] of [
    [PATH_TO.adminUser(id, 'disable'), {}],
    [PATH_TO.adminUser(id, 'role'), { role: 'user' }],
    [PATH_TO.adminUser(id, 'delete'), {}],
    [PATH_TO.adminUser(id, 'reset-link'), {}],
  ]) {
    const { res, html } = await app.post(admin, path, form);
    assert.equal(res.status, 400, path);
    assert.ok(html.includes(REFUSAL), path);
    assert.doesNotMatch(html, /\/reset\/[A-Za-z0-9_-]{10,}/, path);
  }
  const after = owner();
  assert.equal(after.role, 'admin');
  assert.equal(after.disabled, 0);
  assert.equal(app.context.users.passwordHashById(after.id), app.context.users.passwordHashById(before.id));
  assert.equal(rowCount(app.context.db, 'reset_tokens', 'user_id = ?', id), 0);
});

test('the delete page for the env admin shows the note and no form', async () => {
  const admin = await otherAdmin();
  const { res, html } = await app.get(admin, PATH_TO.adminUser(owner().id, 'delete'));
  assert.equal(res.status, 200);
  assert.ok(html.includes(NOTE));
  assert.doesNotMatch(html, /action="\/admin\/users\/\d+\/delete"/);
});

test('/account shows the env admin no password form and no .env note, and refuses the change', async () => {
  const session = await app.login(EMAIL, PASSWORD);
  const page = await app.get(session, PATHS.account);
  assert.equal(page.res.status, 200);
  assert.ok(!page.html.includes(NOTE));
  assert.ok(page.html.includes(`Signed in as ${EMAIL}`));
  assert.doesNotMatch(page.html, /action="\/account\/password"/);

  const before = app.context.users.passwordHashById(owner().id);
  const { res, html } = await app.post(session, PATHS.accountPassword, {
    current: PASSWORD,
    next: 'another long password',
  });
  assert.equal(res.status, 400);
  assert.ok(html.includes(REFUSAL));
  assert.equal(app.context.users.passwordHashById(owner().id), before);
  assert.ok(await verifyPassword(PASSWORD, app.context.users.passwordHashById(owner().id)));
  assert.ok(app.context.sessions.liveByToken(session.cookie.slice('sid='.length)), 'still signed in');
});

test('other users still see the /account password form', async () => {
  const session = await app.signedIn();
  const { html } = await app.get(session, PATHS.account);
  assert.match(html, /action="\/account\/password"/);
  assert.ok(!html.includes(NOTE));
});

test('a reset link for the env admin is refused on GET and POST and the password stays', async () => {
  const id = owner().id;
  const token = legacyResetLink(app.context, { userId: id });
  const before = app.context.users.passwordHashById(owner().id);
  const page = await app.request(PATH_TO.reset(token));
  const pageHtml = await page.text();
  assert.ok(pageHtml.includes(REFUSAL));
  assert.doesNotMatch(pageHtml, /name="password"/);
  const { res, html } = await app.postAnonymous(
    PATH_TO.reset(token),
    { password: 'a hijacked password' },
    { pagePath: PATHS.login },
  );
  assert.equal(res.status, 400);
  assert.ok(html.includes(REFUSAL));
  assert.equal(app.context.users.passwordHashById(owner().id), before);
  assert.ok(await verifyPassword(PASSWORD, app.context.users.passwordHashById(owner().id)));
});

test('a mixed-case ADMIN_EMAIL still protects the account', async () => {
  await withApp({ ADMIN_EMAIL: 'Boss@Example.COM', ADMIN_PASSWORD: PASSWORD }, async (mixed) => {
    const row = mixed.context.users.byEmail('boss@example.com');
    assert.equal(row.email, 'boss@example.com');
    const session = await mixed.signedIn({ role: 'admin' });
    assert.doesNotMatch((await mixed.get(session, PATH_TO.adminUser(row.id))).html, /\/disable"/);
    const { res, html } = await mixed.post(session, PATH_TO.adminUser(row.id, 'disable'));
    assert.equal(res.status, 400);
    assert.ok(html.includes(REFUSAL));
    assert.equal(mixed.context.users.byId(row.id).disabled, 0);
  });
});
