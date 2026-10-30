import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvitesRepository } from '../../db/invites.repository.js';
import { createInvitesService } from '../../services/invites.service.js';
import { createResetService } from '../../services/reset.service.js';
import { MS_PER_DAY } from '../../lib/time.js';
import { buildContext, insertUser } from '../helpers/context.js';
import { ENV_ADMIN } from '../helpers/accounts.js';
import { fakeClock } from '../helpers/clock.js';
import { isPublicError } from '../helpers/assertions.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { activityLog } from '../helpers/activity.js';

async function setup() {
  const clock = fakeClock('2026-01-01T00:00:00Z');
  const { db, context } = buildContext({ now: clock.now });
  const { users, authService, invitesService: invites, resetService: reset } = context;
  const { id: adminId } = await insertUser(context, {
    email: 'adm@x.co',
    displayName: 'Adm',
    password: 'admin-password',
    role: 'admin',
  });
  return { db, context, users, authService, invites, reset, adminId, tick: clock.tick };
}

const form = { email: 'New@Person.co', displayName: '  Newbie ', password: 'long-enough-pw' };

test('invite lifecycle: create, problem, redeem, then already used', async () => {
  const { invites, users, adminId } = await setup();
  const inv = invites.create({ role: 'user', label: 'Bob', createdBy: adminId });
  assert.ok(inv.id && inv.token && inv.expiresAt);
  assert.equal(invites.problemForToken(inv.token), null);
  assert.equal(invites.list().find((r) => r.id === inv.id).label, 'Bob');
  assert.equal(invites.problemForToken('bogus'), 'This invite link is not valid.');
  const userId = await invites.redeem(inv.token, form);
  const u = users.byId(userId);
  assert.equal(u.role, 'user');
  assert.equal(u.email, 'new@person.co');
  assert.equal(u.display_name, 'Newbie');
  assert.equal(invites.problemForToken(inv.token), 'This invite link has already been used.');
  await assert.rejects(
    invites.redeem(inv.token, { ...form, email: 'o@p.co' }),
    isPublicError(ValidationError, 'This invite link has already been used.'),
  );
  assert.equal(invites.list()[0].status, 'used');
});

test('invite role is carried to the user', async () => {
  const { invites, users, adminId } = await setup();
  const inv = invites.create({ role: 'admin', createdBy: adminId });
  assert.equal(users.byId(await invites.redeem(inv.token, form)).role, 'admin');
});

test('invite expiry: 7 days default, expiresInDays override', async () => {
  const { invites, adminId, tick } = await setup();
  const a = invites.create({ role: 'user', createdBy: adminId });
  assert.equal(a.expiresAt, '2026-01-08T00:00:00.000Z');
  const b = invites.create({ role: 'user', createdBy: adminId, expiresInDays: 1 });
  assert.equal(b.expiresAt, '2026-01-02T00:00:00.000Z');
  tick(7 * MS_PER_DAY);
  assert.equal(invites.problemForToken(a.token), null);
  tick(1);
  assert.equal(invites.problemForToken(a.token), 'This invite link has expired.');
  await assert.rejects(invites.redeem(a.token, form), { message: 'This invite link has expired.' });
  assert.equal(invites.list().find((r) => r.id === a.id).status, 'expired');
});

test('revoked invite fails; unknown token fails; status precedence', async () => {
  const { invites, adminId, tick } = await setup();
  const inv = invites.create({ role: 'user', createdBy: adminId });
  invites.revoke(inv.id);
  await assert.rejects(invites.redeem(inv.token, form), { message: 'This invite link has been revoked.' });
  await assert.rejects(invites.redeem('nope', form), { message: 'This invite link is not valid.' });
  tick(8 * MS_PER_DAY);
  assert.equal(invites.list()[0].status, 'revoked');
});

test('list statuses: pending, used, expired, revoked', async () => {
  const { invites, adminId, tick } = await setup();
  const p = invites.create({ role: 'user', createdBy: adminId, expiresInDays: 30 });
  const u = invites.create({ role: 'user', createdBy: adminId, expiresInDays: 30 });
  const e = invites.create({ role: 'user', createdBy: adminId, expiresInDays: 1 });
  const r = invites.create({ role: 'user', createdBy: adminId, expiresInDays: 30 });
  await invites.redeem(u.token, form);
  invites.revoke(r.id);
  tick(2 * MS_PER_DAY);
  const st = Object.fromEntries(invites.list().map((x) => [x.id, x.status]));
  assert.deepEqual(st, { [p.id]: 'pending', [u.id]: 'used', [e.id]: 'expired', [r.id]: 'revoked' });
});

test('only the token hash is stored', async () => {
  const { invites, reset, adminId, db } = await setup();
  const inv = invites.create({ role: 'user', createdBy: adminId });
  const row = db.prepare('SELECT token_hash FROM invites').get();
  assert.notEqual(row.token_hash, inv.token);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  const r = reset.issue(adminId, adminId);
  const rr = db.prepare('SELECT token_hash FROM reset_tokens').get();
  assert.notEqual(rr.token_hash, r.token);
});

test('redeem validation: duplicate, blank or malformed email, short password, name; invite stays usable', async () => {
  const { invites, adminId } = await setup();
  const inv = invites.create({ role: 'user', createdBy: adminId });
  await assert.rejects(
    invites.redeem(inv.token, { ...form, email: '   ' }),
    isPublicError(ValidationError, 'Enter your email address.'),
  );
  for (const email of ['ada', 'a b@x.co', 'ada@example']) {
    await assert.rejects(
      invites.redeem(inv.token, { ...form, email }),
      isPublicError(ValidationError, 'Enter a valid email address.'),
      email,
    );
  }
  await assert.rejects(
    invites.redeem(inv.token, { ...form, email: 'ADM@x.co' }),
    isPublicError(ValidationError, 'An account with that email already exists.'),
  );
  await assert.rejects(invites.redeem(inv.token, { ...form, password: '123456789' }), {
    message: 'Password must be at least 10 characters.',
  });
  await assert.rejects(invites.redeem(inv.token, { ...form, displayName: '   ' }), { message: 'Enter your name.' });
  await assert.rejects(invites.redeem(inv.token, { ...form, displayName: 'x'.repeat(81) }), {
    message: 'Enter your name.',
  });
  assert.equal(invites.problemForToken(inv.token), null);
  await invites.redeem(inv.token, form);
});

test('redeem reports only a UNIQUE email clash as "already exists"; another constraint failure propagates', async () => {
  const { db, invites, adminId } = await setup();
  const inv = invites.create({ role: 'user', createdBy: adminId });
  db.pragma('ignore_check_constraints = ON');
  db.prepare("UPDATE invites SET role = 'root' WHERE id = ?").run(inv.id);
  db.pragma('ignore_check_constraints = OFF');
  await assert.rejects(invites.redeem(inv.token, form), (error) => {
    assert.equal(error.code, 'SQLITE_CONSTRAINT_CHECK');
    assert.notEqual(error.message, 'An account with that email already exists.');
    return true;
  });
  assert.equal(invites.problemForToken(inv.token), null, 'the invite stays usable');
});

test('reset link: valid changes password and ends sessions; single use', async () => {
  const { reset, authService, users, adminId } = await setup();
  const s = await authService.signIn('adm@x.co', 'admin-password');
  const link = reset.issue(adminId, adminId);
  assert.equal(link.expiresAt, '2026-01-02T00:00:00.000Z');
  assert.equal(reset.problemForToken(link.token), null);
  await reset.redeem(link.token, 'brand-new-password');
  assert.equal(authService.loadSession(s.token), null);
  await authService.signIn(users.byId(adminId).email, 'brand-new-password');
  await assert.rejects(reset.redeem(link.token, 'another-password'), {
    message: 'This reset link has already been used.',
  });
  assert.equal(reset.problemForToken(link.token), 'This reset link has already been used.');
});

test('reset link: a failed password write keeps the link usable and the sessions open', async (t) => {
  const { reset, authService, users, adminId } = await setup();
  const s = await authService.signIn('adm@x.co', 'admin-password');
  const link = reset.issue(adminId, adminId);
  const failing = t.mock.method(users, 'setPassword', () => {
    throw new Error('disk full');
  });
  await assert.rejects(reset.redeem(link.token, 'brand-new-password'), /disk full/);
  failing.mock.restore();
  assert.equal(reset.problemForToken(link.token), null, 'the link was not used up');
  assert.ok(authService.loadSession(s.token), 'sessions are kept');
  await authService.signIn('adm@x.co', 'admin-password');
  await reset.redeem(link.token, 'brand-new-password');
  await authService.signIn('adm@x.co', 'brand-new-password');
});

test('reset link: expires after 24h + 1ms; unknown invalid; short password keeps link', async () => {
  const { reset, adminId, tick } = await setup();
  const a = reset.issue(adminId, adminId);
  await assert.rejects(reset.redeem(a.token, 'short'), { message: 'Password must be at least 10 characters.' });
  assert.equal(reset.problemForToken(a.token), null);
  tick(MS_PER_DAY + 1);
  await assert.rejects(
    reset.redeem(a.token, 'brand-new-password'),
    isPublicError(ValidationError, 'This reset link has expired.'),
  );
  await assert.rejects(reset.redeem('nope', 'brand-new-password'), { message: 'This reset link is not valid.' });
});

test('problemForToken names why an invite cannot be used, or null', async () => {
  const { invites, adminId, tick } = await setup();
  assert.equal(invites.problemForToken('bogus'), 'This invite link is not valid.');
  const used = invites.create({ role: 'user', createdBy: adminId });
  assert.equal(invites.problemForToken(used.token), null);
  await invites.redeem(used.token, form);
  assert.equal(invites.problemForToken(used.token), 'This invite link has already been used.');
  const revoked = invites.create({ role: 'user', createdBy: adminId });
  invites.revoke(revoked.id);
  assert.equal(invites.problemForToken(revoked.token), 'This invite link has been revoked.');
  const old = invites.create({ role: 'user', createdBy: adminId });
  tick(8 * MS_PER_DAY);
  assert.equal(invites.problemForToken(old.token), 'This invite link has expired.');
});

test('problemForToken names why a reset link cannot be used, or null', async () => {
  const { reset, adminId, tick } = await setup();
  assert.equal(reset.problemForToken('nope'), 'This reset link is not valid.');
  const a = reset.issue(adminId, adminId);
  assert.equal(reset.problemForToken(a.token), null);
  await reset.redeem(a.token, 'brand-new-password');
  assert.equal(reset.problemForToken(a.token), 'This reset link has already been used.');
  const b = reset.issue(adminId, adminId);
  tick(MS_PER_DAY + 1);
  assert.equal(reset.problemForToken(b.token), 'This reset link has expired.');
});

test('reset link: issuing a new one leaves only the newest usable', async () => {
  const { reset, adminId } = await setup();
  const first = reset.issue(adminId, adminId);
  const second = reset.issue(adminId, adminId);
  assert.equal(reset.problemForToken(first.token), 'This reset link is not valid.');
  await assert.rejects(reset.redeem(first.token, 'brand-new-password'), { name: 'ValidationError' });
  assert.equal(reset.problemForToken(second.token), null);
  await reset.redeem(second.token, 'brand-new-password');
});

const ENC_KEY = Buffer.alloc(32, 7);

function withKey(ctx, encKey) {
  return createInvitesService({
    runInTransaction: ctx.context.runInTransaction,
    invites: createInvitesRepository(ctx.db),
    users: ctx.users,
    authService: ctx.authService,
    encKey,
  });
}

test('canShowLinks is true only when an encryption key keeps a copy of the token', async () => {
  const ctx = await setup();
  assert.equal(withKey(ctx, ENC_KEY).canShowLinks(), true);
  assert.equal(withKey(ctx, null).canShowLinks(), false);
});

test("with a key, a pending invite's link can be copied again; using it clears the stored token", async () => {
  const ctx = await setup();
  const invites = withKey(ctx, ENC_KEY);
  const inv = invites.create({ role: 'user', createdBy: ctx.adminId });
  const stored = ctx.db.prepare('SELECT token_enc FROM invites WHERE id = ?').get(inv.id).token_enc;
  assert.match(stored, /^enc:v1:/);
  assert.ok(!stored.includes(inv.token), 'stored encrypted, not in plain text');
  const row = invites.list().find((r) => r.id === inv.id);
  assert.equal(row.copyToken, inv.token);
  assert.ok(!('token_enc' in row), 'the encrypted column is not returned');

  assert.equal(
    withKey(ctx, Buffer.alloc(32, 9))
      .list()
      .find((r) => r.id === inv.id).copyToken,
    null,
  );

  await invites.redeem(inv.token, form);
  assert.equal(ctx.db.prepare('SELECT token_enc FROM invites WHERE id = ?').get(inv.id).token_enc, null);
  assert.equal(invites.list().find((r) => r.id === inv.id).copyToken, null);
});

test('revoking an invite clears its stored token; expired invites cannot be copied', async () => {
  const ctx = await setup();
  const invites = withKey(ctx, ENC_KEY);
  const revoked = invites.create({ role: 'user', createdBy: ctx.adminId });
  invites.revoke(revoked.id);
  assert.equal(ctx.db.prepare('SELECT token_enc FROM invites WHERE id = ?').get(revoked.id).token_enc, null);

  const old = invites.create({ role: 'user', createdBy: ctx.adminId, expiresInDays: -1 });
  const row = invites.list().find((r) => r.id === old.id);
  assert.equal(row.status, 'expired');
  assert.equal(row.copyToken, null);
});

test('without a key, no token is stored and nothing can be copied', async () => {
  const ctx = await setup();
  const invites = withKey(ctx, null);
  const inv = invites.create({ role: 'user', createdBy: ctx.adminId });
  assert.equal(ctx.db.prepare('SELECT token_enc FROM invites WHERE id = ?').get(inv.id).token_enc, null);
  assert.equal(invites.list().find((r) => r.id === inv.id).copyToken, null);
});

test('resetService.issue refuses the env admin and still issues for other users', async () => {
  const { context } = buildContext({ env: { ADMIN_EMAIL: ENV_ADMIN.email, ADMIN_PASSWORD: ENV_ADMIN.password } });
  const owner = await insertUser(context, { email: ENV_ADMIN.email, password: ENV_ADMIN.password, role: 'admin' });
  const other = await insertUser(context);
  assert.throws(() => context.resetService.issue(owner.id, null), { name: 'ValidationError' });
  assert.ok(context.resetService.issue(other.id, null).token);
});

test('reset link: one that expires while the password is hashed is refused inside the transaction', async () => {
  const { context, authService, users, adminId, tick } = await setup();
  const reset = createResetService({
    runInTransaction: context.runInTransaction,
    resetTokens: context.resetTokens,
    users,
    now: context.now,
    authService: {
      ...authService,
      validatePassword: (password) => {
        authService.validatePassword(password);
        tick(MS_PER_DAY + 1);
      },
    },
  });
  const link = reset.issue(adminId, adminId);
  await assert.rejects(
    reset.redeem(link.token, 'brand-new-password'),
    isPublicError(ValidationError, 'This reset link has expired.'),
  );
  await authService.signIn('adm@x.co', 'admin-password');
});

test('reset link: one replaced by a newer link while the password is hashed is refused as not valid', async () => {
  const { context, authService, users, adminId } = await setup();
  let replaceDuringHash = false;
  const reset = createResetService({
    runInTransaction: context.runInTransaction,
    resetTokens: context.resetTokens,
    users,
    now: context.now,
    authService: {
      ...authService,
      validatePassword: (password) => {
        authService.validatePassword(password);
        if (replaceDuringHash) reset.issue(adminId, adminId);
      },
    },
  });
  const link = reset.issue(adminId, adminId);
  replaceDuringHash = true;
  await assert.rejects(reset.redeem(link.token, 'brand-new-password'), { message: 'This reset link is not valid.' });
  await authService.signIn('adm@x.co', 'admin-password');
});

test('revoke throws NotFoundError for an invite that is not pending, or unknown', async () => {
  const { invites, adminId } = await setup();
  const inv = invites.create({ role: 'user', createdBy: adminId });
  assert.equal(invites.revoke(inv.id), undefined);
  assert.throws(() => invites.revoke(inv.id), NotFoundError, 'already revoked');
  assert.throws(() => invites.revoke(9999), NotFoundError);
});

test('invite events: created (label), revoked (label), used (the new email); never the token', async () => {
  const { context, invites, adminId } = await setup();
  const first = invites.create({ role: 'user', label: 'Bob', createdBy: adminId });
  const second = invites.create({ role: 'admin', createdBy: adminId });
  invites.revoke(first.id, adminId);
  const userId = await invites.redeem(second.token, form);
  const rows = activityLog(context);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.actor_id, r.details]),
    [
      ['inviteCreated', adminId, 'Bob'],
      ['inviteCreated', adminId, 'admin invite'],
      ['inviteRevoked', adminId, 'Bob'],
      ['inviteUsed', userId, 'new@person.co'],
    ],
  );
  assert.ok(!JSON.stringify(rows).includes(first.token) && !JSON.stringify(rows).includes(second.token));
});

test('a refused revoke records nothing', async () => {
  const { context, invites, adminId } = await setup();
  assert.throws(() => invites.revoke(9999, adminId), { name: 'NotFoundError' });
  assert.equal(activityLog(context).length, 0);
});

test('reset events: link issued (actor the admin, subject the user) and password reset done (actor the user)', async () => {
  const { context, reset, adminId } = await setup();
  const other = await insertUser(context, { email: 'target@x.co', displayName: 'Target' });
  const link = reset.issue(other.id, adminId);
  await reset.redeem(link.token, 'brand-new-password');
  const [issued, done] = activityLog(context);
  assert.equal(issued.kind, 'resetLinkIssued');
  assert.equal(issued.actor_id, adminId);
  assert.equal(issued.subject_user_id, other.id);
  assert.equal(issued.subject_name, 'Target');
  assert.equal(done.kind, 'passwordResetDone');
  assert.equal(done.actor_id, other.id);
  assert.ok(!JSON.stringify([issued, done]).includes(link.token));
});

test('countPending counts only invites that can still be used', async () => {
  const { invites, adminId, tick } = await setup();
  assert.equal(invites.countPending(), 0);
  invites.create({ role: 'user', createdBy: adminId });
  const revoked = invites.create({ role: 'user', createdBy: adminId });
  invites.revoke(revoked.id, adminId);
  invites.create({ role: 'user', createdBy: adminId, expiresInDays: 1 });
  assert.equal(invites.countPending(), 2);
  tick(2 * MS_PER_DAY);
  assert.equal(invites.countPending(), 1, 'the one-day invite has expired; the other still counts');
});
