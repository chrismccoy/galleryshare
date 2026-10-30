import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ejs from 'ejs';
import { countAttr, inviteTokenFrom, startApp, withApp } from '../helpers/http.js';
import { ROLES, ROLE_LABELS } from '../../domain/roles.js';
import { MAX_INVITE_LABEL } from '../../domain/limits.js';
import { assertNotFoundPage } from '../helpers/assertions.js';
import { PROJECT_ROOT } from '../../config/root.js';
import { APP_LOCALS } from '../../routes/view/app-locals.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const adminSession = (options = {}) => app.signedIn({ role: 'admin', ...options });

test('non-admins get 404 on every admin page', async () => {
  const { user, ...s } = await app.signedIn();
  for (const p of [PATHS.admin.overview, PATHS.admin.users, PATHS.admin.invites, PATH_TO.adminUser(user.id)]) {
    assert.equal((await app.get(s, p)).res.status, 404, p);
  }
  assert.equal((await app.post(s, PATH_TO.adminUser(user.id, 'disable'))).res.status, 404);
});

test('the overview users line counts every role, admins first, then the disabled accounts', async () => {
  await withApp(async (fresh) => {
    const admin = await fresh.signedIn({ role: 'admin' });
    await fresh.createUser();
    const disabled = await fresh.createUser();
    fresh.context.users.setDisabled(disabled.id, true);
    const { html } = await fresh.get(admin, PATHS.admin.overview);
    const stats = fresh.context.usersService.stats();
    const counts = ROLES.toReversed().map((role) => `${stats.byRole[role]} ${ROLE_LABELS[role].toLowerCase()}`);
    assert.ok(html.includes(`${counts.join(', ')}, ${stats.disabled} disabled`), counts.join(', '));
    assert.ok(html.includes(`1 admin, 2 user, 1 disabled`));
  });
});

test('invite URL is shown once; list never contains the token', async () => {
  const admin = await adminSession();
  const { res, html } = await app.post(admin, PATHS.admin.invites, { role: 'user', label: 'for carol' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'one-time link page is not cached');
  const url = /http:\/\/[^"<\s]+\/invite\/([A-Za-z0-9_-]+)/.exec(html);
  assert.ok(url, 'full url shown');
  const token = url[1];
  const list = await app.get(admin, PATHS.admin.invites);
  assert.equal(list.res.status, 200);
  assert.ok(!list.html.includes(token));
  assert.match(list.html, /for carol/);
  assert.match(list.html, /pending/);
});

test('invite with role admin creates an admin on redeem; revoke blocks it', async () => {
  const admin = await adminSession();
  const { html } = await app.post(admin, PATHS.admin.invites, { role: 'admin', label: 'admin to redeem' });
  const token = inviteTokenFrom(html);
  const { res: reg } = await app.postAnonymous(PATH_TO.invite(token), {
    display_name: 'New Admin',
    email: 'newadmin@example.com',
    password: 'a long enough password',
  });
  assert.equal(reg.status, 303);
  assert.equal(app.context.users.byEmail('newadmin@example.com').role, 'admin');

  const second = await app.post(admin, PATHS.admin.invites, { role: 'user', label: 'user to revoke' });
  const t2 = inviteTokenFrom(second.html);
  const row = app.context.invitesService.list().find((i) => i.label === 'user to revoke');
  assert.equal(row.status, 'pending');
  const rev = await app.post(admin, PATH_TO.adminInvite(row.id, 'revoke'));
  assert.equal(rev.res.status, 303);
  assert.match(rev.res.headers.get('location'), /^\/admin\/invites\?notice=/);
  assert.match(app.context.invitesService.problemForToken(t2) ?? '', /revoked/);

  const used = app.context.invitesService.list().find((i) => i.label === 'admin to redeem');
  assert.equal(used.status, 'used');
  for (const id of [row.id, used.id, 99999]) {
    assertNotFoundPage(await app.post(admin, PATH_TO.adminInvite(id, 'revoke')), String(id));
  }
  assert.equal(app.context.invitesService.list().find((i) => i.id === used.id).status, 'used');
});

test('invite form rejects a bad role and a long label', async () => {
  const admin = await adminSession();
  assert.equal((await app.post(admin, PATHS.admin.invites, { role: 'root' })).res.status, 400);
  assert.equal(
    (await app.post(admin, PATHS.admin.invites, { role: 'user', label: 'x'.repeat(MAX_INVITE_LABEL + 1) })).res.status,
    400,
  );
});

test('an admin cannot delete themself (400); once demoted they lose the admin routes, and the last admin cannot be removed', async () => {
  await withApp(async (solo) => {
    const { user: admin, ...s } = await solo.signedIn({ role: 'admin' });
    const self = await solo.post(s, PATH_TO.adminUser(admin.id, 'delete'));
    assert.equal(self.res.status, 400);
    assert.match(self.html, /You can&#39;t delete your own account\./);

    const other = await solo.createUser({ role: 'user' });
    await solo.post(s, PATH_TO.adminUser(other.id, 'role'), { role: 'admin' });
    await solo.context.usersService.setRole(admin.id, 'user');
    const onlyAdminDelete = await solo.post(s, PATH_TO.adminUser(other.id, 'delete'));
    assert.equal(onlyAdminDelete.res.status, 404);
    await assert.rejects(() => solo.context.usersService.remove(other.id), /At least one admin must remain\./);
    assert.ok(solo.context.users.byId(other.id));
  });
});

test('your own account: role change and disable answer 400 with the reason, and the page hides those controls', async () => {
  await withApp(async (solo) => {
    const { user: admin, ...s } = await solo.signedIn({ role: 'admin' });
    const bob = await solo.createUser({ role: 'user' });
    await solo.createUser({ role: 'admin' });
    const role = await solo.post(s, PATH_TO.adminUser(admin.id, 'role'), { role: 'user' });
    assert.equal(role.res.status, 400);
    assert.match(role.html, /You can&#39;t change your own role\./);
    assert.equal(solo.context.users.byId(admin.id).role, 'admin');
    const dis = await solo.post(s, PATH_TO.adminUser(admin.id, 'disable'));
    assert.equal(dis.res.status, 400);
    assert.match(dis.html, /You can&#39;t disable your own account\./);
    assert.equal(solo.context.users.byId(admin.id).disabled, 0);
    const page = (await solo.get(s, PATH_TO.adminUser(admin.id))).html;
    assert.match(page, /data-own-account/);
    assert.doesNotMatch(page, new RegExp(`${PATH_TO.adminUser(admin.id)}/(disable|role|delete)"`));
    assert.ok(solo.context.users.byId(bob.id));
  });
});

test('delete needs a confirm page; POST removes the user', async () => {
  const admin = await adminSession();
  const bob = await app.createUser({ displayName: 'Doomed Dan' });
  const page = await app.get(admin, PATH_TO.adminUser(bob.id, 'delete'));
  assert.equal(page.res.status, 200);
  assert.match(page.html, /Doomed Dan/);
  assert.ok(app.context.users.byId(bob.id));
  const r = await app.post(admin, PATH_TO.adminUser(bob.id, 'delete'));
  assert.equal(r.res.status, 303);
  assert.equal(app.context.users.byId(bob.id), null);
});

test('reset link URL contains /reset/ and is not in a redirect', async () => {
  const admin = await adminSession();
  const bob = await app.createUser();
  const { res, html } = await app.post(admin, PATH_TO.adminUser(bob.id, 'reset-link'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'one-time link page is not cached');
  assert.equal(res.headers.get('location'), null);
  assert.match(html, /http:\/\/[^"<\s]+\/reset\/[A-Za-z0-9_-]+/);
});

test('the user page shows the profile panel', async () => {
  const admin = await adminSession();
  const bob = await app.createUser();
  const { html } = await app.get(admin, PATH_TO.adminUser(bob.id));
  assert.match(html, /data-widget="profile"/);
});

test('disable, enable and role changes redirect with a whitelisted notice', async () => {
  const admin = await adminSession();
  const bob = await app.createUser();
  let r = await app.post(admin, PATH_TO.adminUser(bob.id, 'disable'));
  assert.equal(r.res.status, 303);
  assert.equal(app.context.users.byId(bob.id).disabled, 1);
  r = await app.post(admin, PATH_TO.adminUser(bob.id, 'enable'));
  assert.equal(r.res.status, 303);
  assert.equal(app.context.users.byId(bob.id).disabled, 0);
  r = await app.post(admin, PATH_TO.adminUser(bob.id, 'role'), { role: 'admin' });
  assert.equal(r.res.status, 303);
  assert.equal(app.context.users.byId(bob.id).role, 'admin');
  const page = await app.get(admin, `${PATH_TO.adminUser(bob.id)}?notice=__proto__`);
  assert.equal(page.res.status, 200);
  assert.ok(!page.html.includes('[object'));
  const ok = await app.get(admin, `${PATH_TO.adminUser(bob.id)}?notice=role`);
  assert.match(ok.html, /Role updated\./);
});

test('bad user ids are 404', async () => {
  const admin = await adminSession();
  for (const id of ['abc', '0', '-1', '1.5', '99999']) {
    assert.equal((await app.get(admin, PATH_TO.adminUser(id))).res.status, 404, id);
  }
  assert.equal((await app.post(admin, PATH_TO.adminUser('abc', 'disable'))).res.status, 404);
});

test('users list shows people', async () => {
  const admin = await adminSession();
  const u = await app.createUser({ displayName: 'Listed Lou' });
  const { res, html } = await app.get(admin, PATHS.admin.users);
  assert.equal(res.status, 200);
  assert.match(html, /Listed Lou/);
  assert.match(html, new RegExp(PATH_TO.adminUser(u.id)));
});

test('with SETTINGS_ENC_KEY a pending invite has Copy with its link; used and revoked ones do not', async () => {
  await withApp({ SETTINGS_ENC_KEY: 'cd'.repeat(32) }, async (keyed) => {
    const s = await keyed.signedIn({ role: 'admin' });
    const token = inviteTokenFrom((await keyed.post(s, PATHS.admin.invites, { role: 'user', label: 'copy me' })).html);
    const revokedToken = inviteTokenFrom((await keyed.post(s, PATHS.admin.invites, { role: 'user' })).html);
    const revokedId = keyed.context.invitesService.list().find((i) => i.label === null).id;
    await keyed.post(s, PATH_TO.adminInvite(revokedId, 'revoke'));

    const list = await keyed.get(s, PATHS.admin.invites);
    const { html } = list;
    assert.equal(list.res.headers.get('cache-control'), 'no-store', 'a page carrying links is not cached');
    assert.match(html, new RegExp(`data-copy-link="http://[^"]+/invite/${token}"`));
    assert.ok(!html.includes(revokedToken), 'a revoked invite has no Copy');
    assert.equal(countAttr(html, 'data-copy-link'), 1);
    assert.doesNotMatch(html, /data-copy-help/);
    assert.match(html, /src="\/js\/copy-link\.js"/);
  });
});

test('without SETTINGS_ENC_KEY the invites list has no Copy and says how to enable it', async () => {
  const admin = await adminSession();
  await app.post(admin, PATHS.admin.invites, { role: 'user' });
  const list = await app.get(admin, PATHS.admin.invites);
  assert.doesNotMatch(list.html, /data-copy-link=/);
  assert.match(list.html, /data-copy-help/);
  assert.notEqual(list.res.headers.get('cache-control'), 'no-store');
});

test('user-delete: the refusal shows only its own error, never an inherited page notice', async () => {
  const html = await ejs.renderFile(path.join(PROJECT_ROOT, 'views', 'pages', 'admin', 'user-delete.ejs'), {
    ...APP_LOCALS,
    csrfToken: 'tok',
    target: { id: 2, display_name: 'Me', email: 'me@example.com' },
    isSelf: true,
    managedByEnv: false,
    ownAccountMessage: 'You cannot delete your own account.',
    envAdminMessage: 'env',
    notice: 'A stray notice.',
    noticeLink: { href: '/x', label: 'stray' },
  });
  assert.match(html, /You cannot delete your own account\./);
  assert.doesNotMatch(html, /A stray notice|stray/);
});

test('an unknown role on the role route is refused with 400 and the reason; the role stays', async () => {
  const admin = await adminSession();
  const user = await app.createUser({ role: 'user' });
  const res = await app.post(admin, PATH_TO.adminUser(user.id, 'role'), { role: 'root' });
  assert.equal(res.res.status, 400);
  assert.match(res.html, /Choose a valid role\./);
  assert.equal(app.context.users.byId(user.id).role, 'user');
});

test('deleting a user goes back to Users with the "User deleted." notice', async () => {
  const admin = await adminSession();
  const user = await app.createUser({ role: 'user' });
  const res = await app.post(admin, PATH_TO.adminUser(user.id, 'delete'));
  assert.equal(res.res.status, 303);
  const location = res.res.headers.get('location');
  assert.equal(location, `${PATHS.admin.users}?notice=deleted`);
  const page = await app.get(admin, location);
  assert.match(page.html, /User deleted\./);
  assert.equal(app.context.users.byId(user.id), null);
});
