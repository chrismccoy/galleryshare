import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, insertUser } from '../helpers/context.js';
import { fakeClock } from '../helpers/clock.js';
import { ENV_ADMIN } from '../helpers/accounts.js';
import { hashPassword } from '../../lib/password.js';
import { InvalidCredentialsError, ValidationError } from '../../lib/errors.js';
import { ENV_ADMIN_MESSAGE } from '../../domain/accounts.js';
import { MS_PER_DAY } from '../../lib/time.js';
import { isPublicError } from '../helpers/assertions.js';

async function setup({ envAdminEmail } = {}) {
  const clock = fakeClock('2026-01-01T00:00:00Z');
  const env = envAdminEmail ? { ADMIN_EMAIL: envAdminEmail, ADMIN_PASSWORD: ENV_ADMIN.password } : {};
  const { db, context } = buildContext({ env, now: clock.now });
  const { users, sessions, authService } = context;
  const { id } = await insertUser(context, { email: 'a@b.co', displayName: 'A', password: 'correct-horse' });
  return { db, clock, context, users, sessions, authService, id };
}

test('signIn: success gives session; loadSession returns user and csrf', async () => {
  const { authService, id } = await setup();
  const s = await authService.signIn(' A@B.co ', 'correct-horse');
  assert.equal(s.user.id, id);
  const loaded = authService.loadSession(s.token);
  assert.equal(loaded.user.id, id);
  assert.equal(loaded.csrfToken, s.csrfToken);
  authService.signOut(s.token);
  assert.equal(authService.loadSession(s.token), null);
  assert.equal(authService.loadSession('nope'), null);
});

test('signIn: wrong password and unknown email throw InvalidCredentialsError', async () => {
  const { authService } = await setup();
  await assert.rejects(authService.signIn('a@b.co', 'bad'), InvalidCredentialsError);
  await assert.rejects(authService.signIn('x@b.co', 'bad'), InvalidCredentialsError);
});

test('sessions expire after sessionDays', async () => {
  const { authService, clock } = await setup();
  const s = await authService.signIn('a@b.co', 'correct-horse');
  clock.tick(30 * MS_PER_DAY - 1);
  assert.ok(authService.loadSession(s.token));
  clock.tick(2);
  assert.equal(authService.loadSession(s.token), null);
});

test('disabled user cannot sign in and existing session stops loading', async () => {
  const { authService, users, id } = await setup();
  const s = await authService.signIn('a@b.co', 'correct-horse');
  users.setDisabled(id, true);
  assert.equal(authService.loadSession(s.token), null);
  await assert.rejects(authService.signIn('a@b.co', 'correct-horse'), InvalidCredentialsError);
});

test('changePassword: wrong current rejected; success ends sessions', async () => {
  const { authService, id } = await setup();
  const s = await authService.signIn('a@b.co', 'correct-horse');
  await assert.rejects(authService.changePassword(id, 'wrong', 'new-password-1'), InvalidCredentialsError);
  assert.ok(authService.loadSession(s.token));
  await assert.rejects(authService.changePassword(id, 'correct-horse', 'short'), ValidationError);
  await authService.changePassword(id, 'correct-horse', 'new-password-1');
  assert.equal(authService.loadSession(s.token), null);
  await assert.rejects(authService.signIn('a@b.co', 'correct-horse'), InvalidCredentialsError);
  await authService.signIn('a@b.co', 'new-password-1');
});

test('changePassword: the .env admin is refused with ENV_ADMIN_MESSAGE, whatever the current password', async () => {
  const { authService, users, id } = await setup({ envAdminEmail: 'a@b.co' });
  const s = await authService.signIn('a@b.co', 'correct-horse');
  const before = users.passwordHashById(id);
  const refused = isPublicError(ValidationError, ENV_ADMIN_MESSAGE);
  await assert.rejects(authService.changePassword(id, 'correct-horse', 'new-password-1'), refused);
  await assert.rejects(authService.changePassword(id, 'wrong', 'new-password-1'), refused);
  assert.equal(users.passwordHashById(id), before);
  assert.ok(authService.loadSession(s.token), 'sessions are kept');
});

test('setPassword: enforces length, replaces password, ends sessions', async () => {
  const { authService, id } = await setup();
  const s = await authService.signIn('a@b.co', 'correct-horse');
  await assert.rejects(authService.setPassword(id, '123456789'), {
    message: 'Password must be at least 10 characters.',
  });
  await authService.setPassword(id, '1234567890');
  assert.equal(authService.loadSession(s.token), null);
  await authService.signIn('a@b.co', '1234567890');
});

test('applyPasswordHash: stores the hash as given and ends every session of that user only', async () => {
  const { context, users, authService, id } = await setup();
  await insertUser(context, { email: 'other@b.co', displayName: 'O', password: 'other-password' });
  const mine = [
    await authService.signIn('a@b.co', 'correct-horse'),
    await authService.signIn('a@b.co', 'correct-horse'),
  ];
  const theirs = await authService.signIn('other@b.co', 'other-password');
  const hash = await hashPassword('brand-new-password');

  authService.applyPasswordHash(id, hash);

  assert.equal(users.passwordHashById(id), hash);
  for (const s of mine) assert.equal(authService.loadSession(s.token), null);
  assert.notEqual(authService.loadSession(theirs.token), null);
});

test('applyPasswordHash writes in one transaction: when ending the sessions fails, the old password stays', async (t) => {
  const { users, sessions, authService, id } = await setup();
  const s = await authService.signIn('a@b.co', 'correct-horse');
  const before = users.passwordHashById(id);
  const failing = t.mock.method(sessions, 'removeForUser', () => {
    throw new Error('disk full');
  });
  assert.throws(() => authService.applyPasswordHash(id, 'new-hash'), /disk full/);
  failing.mock.restore();
  assert.equal(users.passwordHashById(id), before, 'the password write was rolled back');
  assert.notEqual(authService.loadSession(s.token), null);
});

test('changePassword records passwordChanged for the user, and a failed change records nothing', async () => {
  const { context, authService, id } = await setup();
  await assert.rejects(authService.changePassword(id, 'wrong', 'new-password-1'), InvalidCredentialsError);
  assert.equal(context.activity.list({ limit: 10 }).length, 0);
  await authService.changePassword(id, 'correct-horse', 'new-password-1');
  const [row] = context.activity.list({ limit: 10 });
  assert.equal(row.kind, 'passwordChanged');
  assert.equal(row.area, 'accounts');
  assert.equal(row.actor_id, id);
  assert.ok(!JSON.stringify(row).includes('new-password-1'));
});
