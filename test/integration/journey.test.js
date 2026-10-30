import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inviteTokenFrom, startApp } from '../helpers/http.js';
import { ENV_ADMIN } from '../helpers/accounts.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

const ADMIN_EMAIL = ENV_ADMIN.email;
const ADMIN_PASSWORD = ENV_ADMIN.password;

let app;
before(async () => {
  app = await startApp({ ADMIN_EMAIL, ADMIN_PASSWORD });
});
after(() => app.close());

test('env admin signs in, invites a visitor, who registers and lands on the dashboard', async () => {
  assert.equal(app.context.users.byEmail(ADMIN_EMAIL).role, 'admin');
  const admin = await app.login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const created = await app.post(admin, PATHS.admin.invites, { role: 'user', label: 'smoke' });
  assert.equal(created.res.status, 200);
  const token = inviteTokenFrom(created.html);
  assert.ok(token, 'invite link is shown on the response');

  const { res: redeemed } = await app.postAnonymous(PATH_TO.invite(token), {
    display_name: 'Visitor',
    email: 'visitor@example.com',
    password: 'visitor long password',
  });
  assert.equal(redeemed.status, 303);
  const visitor = app.context.users.byEmail('visitor@example.com');
  assert.equal(visitor.role, 'user');
  const user = await app.login('visitor@example.com', 'visitor long password');

  const root = await app.request(PATHS.front, { cookie: user.cookie });
  assert.equal(root.headers.get('location'), PATHS.dashboard);
  const { res, html } = await app.get(user, PATHS.dashboard);
  assert.equal(res.status, 200);
  assert.match(html, /No galleries yet\./);
  assert.doesNotMatch(html, /href="\/admin/);

  const adminDash = await app.get(admin, PATHS.dashboard);
  assert.match(adminDash.html, /href="\/admin\/settings"/);
});
