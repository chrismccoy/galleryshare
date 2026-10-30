import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext, mediaContext } from '../helpers/context.js';
import { ENV_ADMIN, insertBareUserRow, openSession } from '../helpers/accounts.js';
import { later } from '../helpers/clock.js';
import { recordingLogger } from '../helpers/logger.js';
import { rowCount } from '../helpers/db.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { ENV_ADMIN_MESSAGE } from '../../domain/accounts.js';
import { isPublicError } from '../helpers/assertions.js';
import { activityLog } from '../helpers/activity.js';

const LAST_ADMIN = 'At least one admin must remain.';
const isLastAdmin = isPublicError(ValidationError, LAST_ADMIN);

function setup(env = {}) {
  const { db, context } = buildContext({ env });
  const { users, sessions, usersService: service, invitesService } = context;
  const makeUser = (email, role = 'user') => insertBareUserRow(context, { email, role });
  const sessionCount = (id) => rowCount(db, 'sessions', 'user_id = ?', id);
  return { db, users, sessions, service, invitesService, makeUser, sessionCount };
}

let fixture;
beforeEach(() => {
  fixture = setup();
});

test('removing, demoting or disabling the last admin throws', async () => {
  const admin = fixture.makeUser('admin@x.com', 'admin');
  await assert.rejects(() => fixture.service.remove(admin.id), isLastAdmin);
  assert.throws(() => fixture.service.setRole(admin.id, 'user'), isLastAdmin);
  assert.throws(() => fixture.service.disable(admin.id), isLastAdmin);
  const after = fixture.users.byId(admin.id);
  assert.equal(after.role, 'admin');
  assert.equal(after.disabled, 0);
});

test('an admin cannot disable, demote or delete their own account, even with another admin present', async () => {
  const a = fixture.makeUser('self-a@x.com', 'admin');
  fixture.makeUser('self-b@x.com', 'admin');
  const own = (text) => isPublicError(ValidationError, text);
  assert.throws(() => fixture.service.disable(a.id, a.id), own("You can't disable your own account."));
  assert.throws(() => fixture.service.setRole(a.id, 'user', a.id), own("You can't change your own role."));
  await assert.rejects(() => fixture.service.remove(a.id, a.id), own("You can't delete your own account."));
  const after = fixture.users.byId(a.id);
  assert.equal(after.role, 'admin');
  assert.equal(after.disabled, 0);
});

test('a disabled admin does not count toward the last enabled admin', () => {
  const a = fixture.makeUser('a@x.com', 'admin');
  const b = fixture.makeUser('b@x.com', 'admin');
  fixture.users.setDisabled(b.id, true);
  assert.throws(() => fixture.service.setRole(a.id, 'user'), isLastAdmin);
  fixture.service.setRole(b.id, 'user', a.id);
  assert.equal(fixture.users.byId(b.id).role, 'user');
});

test('with two admins one can be demoted, disabled or removed', async () => {
  const a = fixture.makeUser('a@x.com', 'admin');
  const b = fixture.makeUser('b@x.com', 'admin');
  fixture.service.disable(b.id, a.id);
  assert.equal(fixture.users.byId(b.id).disabled, 1);
  fixture.service.enable(b.id);
  assert.equal(fixture.users.byId(b.id).disabled, 0);
  fixture.service.setRole(b.id, 'user', a.id);
  assert.equal(fixture.users.byId(b.id).role, 'user');
  fixture.service.setRole(b.id, 'admin', a.id);
  await fixture.service.remove(b.id, a.id);
  assert.equal(fixture.users.byId(b.id), null);
});

test('disable revokes sessions', () => {
  const admin = fixture.makeUser('admin@x.com', 'admin');
  const u = fixture.makeUser('u@x.com');
  openSession(fixture.sessions, { userId: u.id, expiresAt: later() });
  openSession(fixture.sessions, { userId: admin.id, expiresAt: later() });
  fixture.service.disable(u.id, admin.id);
  assert.equal(fixture.sessionCount(u.id), 0);
  assert.equal(fixture.sessionCount(admin.id), 1);
});

test('remove revokes sessions and deletes the user', async () => {
  const admin = fixture.makeUser('admin@x.com', 'admin');
  const u = fixture.makeUser('u@x.com');
  openSession(fixture.sessions, { userId: u.id, expiresAt: later() });
  await fixture.service.remove(u.id, admin.id);
  assert.equal(fixture.users.byId(u.id), null);
  assert.equal(fixture.sessionCount(u.id), 0);
});

test('unknown user and invalid role are rejected', async () => {
  const admin = fixture.makeUser('admin@x.com', 'admin');
  assert.throws(() => fixture.service.disable(9999, admin.id), NotFoundError);
  await assert.rejects(() => fixture.service.remove(9999, admin.id), NotFoundError);
  assert.throws(() => fixture.service.setRole(admin.id, 'root', admin.id), ValidationError);
});

test('remove revokes the pending invites the user created, including admin invites', async () => {
  const a1 = fixture.makeUser('a1@x.com', 'admin');
  const a2 = fixture.makeUser('a2@x.com', 'admin');
  const adminInvite = fixture.invitesService.create({ role: 'admin', createdBy: a2.id });
  const userInvite = fixture.invitesService.create({ role: 'user', createdBy: a2.id });
  const othersInvite = fixture.invitesService.create({ role: 'user', createdBy: a1.id });
  const usedInvite = fixture.invitesService.create({ role: 'user', createdBy: a2.id });
  await fixture.invitesService.redeem(usedInvite.token, {
    email: 'n@x.com',
    displayName: 'N',
    password: 'long-enough-pw',
  });

  await fixture.service.remove(a2.id, a1.id);

  const REVOKED = 'This invite link has been revoked.';
  assert.equal(fixture.invitesService.problemForToken(adminInvite.token), REVOKED);
  assert.equal(fixture.invitesService.problemForToken(userInvite.token), REVOKED);
  await assert.rejects(
    fixture.invitesService.redeem(adminInvite.token, {
      email: 'evil@x.com',
      displayName: 'E',
      password: 'long-enough-pw',
    }),
    { name: 'ValidationError', message: REVOKED },
  );
  assert.equal(fixture.users.byEmail('evil@x.com'), null);
  assert.equal(fixture.invitesService.problemForToken(othersInvite.token), null, "another admin's invite stays live");
  assert.equal(fixture.invitesService.problemForToken(usedInvite.token), 'This invite link has already been used.');
});

test('remove rolls back sessions and invites when deleting the user fails', async (t) => {
  const a1 = fixture.makeUser('a1@x.com', 'admin');
  const u = fixture.makeUser('u@x.com', 'admin');
  openSession(fixture.sessions, { userId: u.id, expiresAt: later() });
  const inv = fixture.invitesService.create({ role: 'user', createdBy: u.id });
  t.mock.method(fixture.users, 'remove', () => {
    throw new Error('disk full');
  });
  await assert.rejects(() => fixture.service.remove(u.id, a1.id), /disk full/);
  assert.equal(fixture.sessionCount(u.id), 1);
  assert.equal(fixture.invitesService.problemForToken(inv.token), null);
});

const isEnvAdminRefusal = isPublicError(ValidationError, ENV_ADMIN_MESSAGE);

test('the env admin cannot be disabled, have its role changed or be deleted', async () => {
  const { service, users, makeUser } = setup({ ADMIN_EMAIL: ENV_ADMIN.email, ADMIN_PASSWORD: ENV_ADMIN.password });
  const owner = makeUser(ENV_ADMIN.email, 'admin');
  const other = makeUser('other@x.com', 'admin');
  const user = makeUser('u@x.com');
  assert.equal(service.isEnvAdmin(owner), true);
  assert.equal(service.isEnvAdmin(other), false);
  assert.throws(() => service.disable(owner.id, other.id), isEnvAdminRefusal);
  assert.throws(() => service.setRole(owner.id, 'user', other.id), isEnvAdminRefusal);
  assert.throws(() => service.setRole(owner.id, 'admin', other.id), isEnvAdminRefusal);
  await assert.rejects(() => service.remove(owner.id, other.id), isEnvAdminRefusal);
  const after = users.byId(owner.id);
  assert.equal(after.role, 'admin');
  assert.equal(after.disabled, 0);
  service.setRole(user.id, 'admin', owner.id);
  service.disable(other.id, owner.id);
  await service.remove(user.id, owner.id);
});

test('without an env admin nobody is protected', () => {
  const a = fixture.makeUser('a@x.com', 'admin');
  const b = fixture.makeUser('b@x.com', 'admin');
  assert.equal(fixture.service.isEnvAdmin(a), false);
  fixture.service.disable(b.id, a.id);
  assert.equal(fixture.users.byId(b.id).disabled, 1);
});

test('removing a user deletes their gallery media folders', async (t) => {
  const { media: dir, context } = mediaContext(t, { prefix: 'gs-users-' });
  insertBareUserRow(context, { email: 'adm@x.com', role: 'admin' });
  const user = insertBareUserRow(context, { email: 'gone@x.com' });
  const keep = insertBareUserRow(context, { email: 'keep@x.com' });
  const g = context.galleries.insert({ userId: user.id });
  const k = context.galleries.insert({ userId: keep.id });
  for (const id of [g, k]) {
    fs.mkdirSync(path.join(dir, String(id), 'orig'), { recursive: true });
    fs.writeFileSync(path.join(dir, String(id), 'orig', '1.jpg'), 'x');
  }
  await context.usersService.remove(user.id);
  assert.equal(fs.existsSync(path.join(dir, String(g))), false);
  assert.equal(fs.existsSync(path.join(dir, String(k))), true);
  assert.equal(context.galleries.byIdIncludingTrashed(g), null);
});

function mediaFixture(t) {
  const { logger, error: logs } = recordingLogger();
  const { media: dir, context } = mediaContext(t, { prefix: 'gs-users-', logger });
  const admin = insertBareUserRow(context, { email: 'adm@x.com', role: 'admin' });
  const user = insertBareUserRow(context, { email: 'gone@x.com' });
  const g = context.galleries.insert({ userId: user.id });
  fs.mkdirSync(path.join(dir, String(g), 'orig'), { recursive: true });
  fs.writeFileSync(path.join(dir, String(g), 'orig', '1.jpg'), 'x');
  return { dir, logs, context, admin, user, g };
}

test('a failing user delete keeps the media folder', async (t) => {
  const m = mediaFixture(t);
  t.mock.method(m.context.users, 'remove', () => {
    throw new Error('disk full');
  });
  await assert.rejects(() => m.context.usersService.remove(m.user.id, m.admin.id), /disk full/);
  assert.equal(fs.existsSync(path.join(m.dir, String(m.g))), true);
  assert.ok(m.context.galleries.liveById(m.g));
});

test('a failing media cleanup is logged and does not reject', async (t) => {
  const m = mediaFixture(t);
  t.mock.method(m.context.mediaStore, 'removeGallery', async () => {
    throw new Error('rm failed');
  });
  await m.context.usersService.remove(m.user.id, m.admin.id);
  assert.equal(m.context.users.byId(m.user.id), null);
  assert.equal(m.logs.length, 1);
  assert.equal(m.logs[0][1].error, 'rm failed');
});

test('account actions record the admin as actor and the target as subject: disabled, enabled, role changed, deleted', async () => {
  const { context } = buildContext();
  const admin = insertBareUserRow(context, { email: 'admin@x.com', role: 'admin' });
  const target = insertBareUserRow(context, { email: 'target@x.com', displayName: 'Tara' });
  const service = context.usersService;
  service.disable(target.id, admin.id);
  service.enable(target.id, admin.id);
  service.setRole(target.id, 'admin', admin.id);
  await service.remove(target.id, admin.id);
  const rows = activityLog(context);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.actor_id, r.subject_user_id, r.subject_name, r.details]),
    [
      ['userDisabled', admin.id, target.id, 'Tara', null],
      ['userEnabled', admin.id, target.id, 'Tara', null],
      ['userRoleChanged', admin.id, target.id, 'Tara', 'user → admin'],
      ['userDeleted', admin.id, target.id, 'Tara', null],
    ],
  );
  assert.equal(context.users.byId(target.id), null);
});

test('a refused account action records nothing', () => {
  const { context } = buildContext();
  const admin = insertBareUserRow(context, { email: 'admin@x.com', role: 'admin' });
  assert.throws(() => context.usersService.disable(admin.id, admin.id), ValidationError);
  assert.equal(context.activity.list({ limit: 10 }).length, 0);
});
