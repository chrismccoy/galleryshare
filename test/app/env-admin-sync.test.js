import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEnvAdmin } from '../../app/env-admin-sync.js';
import { verifyPassword } from '../../lib/password.js';
import { buildContext, insertUser } from '../helpers/context.js';
import { ENV_ADMIN, legacyResetLink, openSession } from '../helpers/accounts.js';
import { later } from '../helpers/clock.js';
import { recordingLogger } from '../helpers/logger.js';

const EMAIL = ENV_ADMIN.email;
const PASSWORD = ENV_ADMIN.password;
const UNCHANGED = Object.freeze({ created: false, promoted: false, reenabled: false, passwordChanged: false });

function syncDeps(context, config, logger) {
  const { users, resetTokens, authService, runInTransaction } = context;
  return { config, users, resetTokens, authService, runInTransaction, logger };
}

function setup(env = {}) {
  const { logger, info: lines, warn: warnings } = recordingLogger();
  const { context, config } = buildContext({ env: { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD, ...env }, logger });
  const sync = (overrides = {}) => syncEnvAdmin(syncDeps(context, { ...config, ...overrides }, logger));
  return { context, config, lines, warnings, sync };
}

const assertNoPassword = (lines, password = PASSWORD) => {
  assert.doesNotMatch(JSON.stringify(lines), new RegExp(password));
};

test('without an env admin, sync does nothing', async () => {
  const { context, config } = buildContext();
  assert.equal(config.admin.email, null);
  const { logger, info, warn, error } = recordingLogger();
  assert.equal(await syncEnvAdmin(syncDeps(context, config, logger)), null);
  assert.deepEqual(context.users.all(), []);
  assert.deepEqual([...info, ...warn, ...error], [], 'nothing is logged');
});

test('creates the env admin: role admin, ADMIN_NAME, hashed password, enabled', async () => {
  const { context, lines, sync } = setup({ ADMIN_NAME: 'Chris' });
  assert.deepEqual(await sync(), { created: true, promoted: false, reenabled: false, passwordChanged: false });
  const row = context.users.byEmail(EMAIL);
  assert.equal(row.role, 'admin');
  assert.equal(row.display_name, 'Chris');
  assert.equal(row.disabled, 0);
  assert.notEqual(context.users.passwordHashById(row.id), PASSWORD);
  assert.ok(await verifyPassword(PASSWORD, context.users.passwordHashById(row.id)));
  assert.equal(lines.length, 1);
  assert.match(lines[0][0], /created/);
  assertNoPassword(lines);
});

test('sync is idempotent: no hash rewrite and sessions kept when the password is unchanged', async () => {
  const { context, lines, sync } = setup();
  await sync();
  const before = context.users.byEmail(EMAIL);
  const session = openSession(context.sessions, { userId: before.id, expiresAt: later() });
  assert.deepEqual(await sync(), UNCHANGED);
  assert.deepEqual(await sync(), UNCHANGED);
  const after = context.users.byEmail(EMAIL);
  assert.equal(context.users.passwordHashById(after.id), context.users.passwordHashById(before.id));
  assert.ok(context.sessions.liveByToken(session.token), 'session kept');
  assert.equal(context.users.all().length, 1);
  assert.equal(lines.length, 3);
  assert.match(lines[2][0], /unchanged/);
  assertNoPassword(lines);
});

test("a changed ADMIN_PASSWORD updates the hash and revokes that user's sessions only", async () => {
  const { context, config, lines, sync } = setup();
  await sync();
  const admin = context.users.byEmail(EMAIL);
  const other = await insertUser(context);
  const adminSession = openSession(context.sessions, { userId: admin.id, expiresAt: later() });
  const otherSession = openSession(context.sessions, { userId: other.id, expiresAt: later() });
  const next = 'a brand new password';
  assert.deepEqual(await sync({ admin: { ...config.admin, password: next } }), { ...UNCHANGED, passwordChanged: true });
  const row = context.users.byEmail(EMAIL);
  assert.ok(await verifyPassword(next, context.users.passwordHashById(row.id)));
  assert.ok(!(await verifyPassword(PASSWORD, context.users.passwordHashById(row.id))));
  assert.equal(context.sessions.liveByToken(adminSession.token), null);
  assert.ok(context.sessions.liveByToken(otherSession.token));
  assert.match(lines.at(-1)[0], /password updated/);
  assertNoPassword(lines, next);
});

test('an existing disabled non-admin with that email is promoted and enabled; the name is kept', async () => {
  const { context, sync, warnings } = setup({ ADMIN_NAME: 'Owner' });
  const existing = await insertUser(context, { email: EMAIL, password: PASSWORD, displayName: 'Old Name' });
  const hashBefore = context.users.passwordHashById(existing.id);
  context.users.setDisabled(existing.id, true);
  assert.deepEqual(await sync(), { ...UNCHANGED, promoted: true, reenabled: true });
  const row = context.users.byId(existing.id);
  assert.equal(row.role, 'admin');
  assert.equal(row.disabled, 0);
  assert.equal(row.display_name, 'Old Name');
  assert.equal(context.users.passwordHashById(row.id), hashBefore);
  const logged = JSON.stringify(warnings);
  assert.match(logged, /promoted/);
  assert.match(logged, /re-enabled/);
  assertNoPassword(warnings);
});

test('no warning when the env admin is already an enabled admin', async () => {
  const { sync, warnings } = setup();
  await sync();
  await sync();
  assert.deepEqual(warnings, []);
});

test("sync removes unused reset links for the env admin and keeps other users' links", async () => {
  const { context, sync } = setup();
  const existing = await insertUser(context, { email: EMAIL, password: PASSWORD, role: 'admin' });
  const other = await insertUser(context);
  const token = legacyResetLink(context, { userId: existing.id });
  const { token: otherToken } = context.resetService.issue(other.id, null);
  await sync();
  assert.equal(context.resetTokens.byToken(token), null, 'the env admin link is gone');
  assert.ok(context.resetTokens.byToken(otherToken), "another user's link stays");
});

test('an existing user with another password gets the env password and loses sessions', async () => {
  const { context, sync } = setup();
  const existing = await insertUser(context, { email: EMAIL, password: 'some other password' });
  const session = openSession(context.sessions, { userId: existing.id, expiresAt: later() });
  assert.deepEqual(await sync(), { ...UNCHANGED, promoted: true, passwordChanged: true });
  const row = context.users.byId(existing.id);
  assert.equal(row.role, 'admin');
  assert.ok(await verifyPassword(PASSWORD, context.users.passwordHashById(row.id)));
  assert.equal(context.sessions.liveByToken(session.token), null);
});

test('the account writes run in one transaction: a failing password write leaves the role and the account as they were', async () => {
  const { context, config, sync } = setup();
  const existing = await insertUser(context, { email: EMAIL, password: 'some other password' });
  context.users.setDisabled(existing.id, true);
  const token = legacyResetLink(context, { userId: existing.id });
  const failing = {
    ...context.authService,
    applyPasswordHash: () => {
      throw new Error('disk full');
    },
  };
  await assert.rejects(
    syncEnvAdmin({ ...syncDeps(context, config, recordingLogger().logger), authService: failing }),
    /disk full/,
  );
  const row = context.users.byId(existing.id);
  assert.equal(row.role, 'user', 'the promotion was rolled back');
  assert.equal(row.disabled, 1, 'the re-enable was rolled back');
  assert.ok(context.resetTokens.byToken(token), 'the reset link was kept');
  await sync();
  assert.equal(context.users.byId(existing.id).role, 'admin');
});
