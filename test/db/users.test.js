import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { fakeClock } from '../helpers/clock.js';
import { createUsersRepository } from '../../db/users.repository.js';

function makeUser(users, email = 'a@b.co', role = 'user') {
  return users.insert({ email, displayName: 'A', passwordHash: 'h', role });
}

test('users: email normalised, lookup, role, disabled, admin count, remove', () => {
  const users = createUsersRepository(freshDb());
  const id = makeUser(users, '  Foo@Bar.COM ');
  assert.equal(users.byEmail('foo@bar.com').id, id);
  assert.equal(users.byEmail(' FOO@bar.com ').display_name, 'A');
  assert.equal(users.passwordHashById(id), 'h');
  assert.ok(!('password_hash' in users.byId(id)), 'finders never return the hash');
  assert.ok(!('password_hash' in users.byEmail('foo@bar.com')));
  assert.ok(users.all().every((u) => !('password_hash' in u)));
  assert.equal(users.passwordHashById(999), null);
  assert.equal(users.byId(999), null);
  const admin = makeUser(users, 'adm@x.co', 'admin');
  assert.equal(users.countActiveAdmins(), 1);
  users.setDisabled(admin, true);
  assert.equal(users.countActiveAdmins(), 0);
  users.setDisabled(admin, false);
  users.setRole(id, 'admin');
  assert.equal(users.countActiveAdmins(), 2);
  assert.equal(users.setPassword(id, 'h2'), true);
  assert.equal(users.passwordHashById(id), 'h2');
  assert.equal(users.setPassword(999, 'h3'), false, 'mutations report a missing user');
  assert.equal(users.all().length, 2);
  users.remove(id);
  assert.equal(users.byId(id), null);
});

test('users stamp created_at and updated_at from the injected clock', () => {
  const db = freshDb();
  const at = '2001-02-03T04:05:06.000Z';
  const { now } = fakeClock(at);
  const uid = makeUser(createUsersRepository(db, { now }));
  const user = db.prepare('SELECT created_at, updated_at FROM users WHERE id = ?').get(uid);
  assert.deepEqual({ ...user }, { created_at: at, updated_at: at });
});

test('users.stats answers in one query', () => {
  const db = freshDb();
  const users = createUsersRepository(db);
  makeUser(users, 'boss@x.co', 'admin');
  makeUser(users, 'a@x.co');
  const b = makeUser(users, 'b@x.co');
  users.setDisabled(b, true);
  assert.deepEqual(users.stats(), { total: 3, admins: 1, byRole: { admin: 1, user: 2 }, disabled: 1 });
});

test('users.backdate sets created_at only, for the demo seed', () => {
  const db = freshDb();
  const users = createUsersRepository(db, { now: fakeClock('2026-01-01T00:00:00Z').now });
  const id = makeUser(users);
  assert.equal(users.backdate(id, '2025-02-03T00:00:00.000Z'), true);
  const row = db.prepare('SELECT created_at, updated_at FROM users WHERE id = ?').get(id);
  assert.equal(row.created_at, '2025-02-03T00:00:00.000Z');
  assert.equal(row.updated_at, '2026-01-01T00:00:00.000Z', 'updated_at is left alone');
  assert.equal(users.backdate(id + 99, '2025-02-03T00:00:00.000Z'), false, 'no such user');
});
