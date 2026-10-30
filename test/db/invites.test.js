import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertBareUser } from '../helpers/accounts.js';
import { freshDb } from '../helpers/db.js';
import { fakeClock } from '../helpers/clock.js';
import { createInvitesRepository } from '../../db/invites.repository.js';

test('invites stamp times from the injected clock', () => {
  const db = freshDb();
  const at = '2026-03-04T05:06:07.000Z';
  const { now } = fakeClock(at);
  const uid = insertBareUser(db);
  const invites = createInvitesRepository(db, { now });
  const expiresAt = '2026-04-01T00:00:00.000Z';
  const used = invites.insert({ token: 'a', role: 'user', createdBy: uid, expiresAt });
  const revoked = invites.insert({ token: 'b', role: 'user', createdBy: uid, expiresAt });
  invites.insert({ token: 'c', role: 'user', createdBy: uid, expiresAt });
  assert.equal(invites.byToken('a').created_at, at);
  assert.equal(invites.markUsed(used, uid), true);
  assert.equal(invites.byToken('a').used_at, at);
  assert.equal(invites.revoke(revoked), true);
  assert.equal(invites.byToken('b').revoked_at, at);
  assert.equal(invites.revokePendingBy(uid), 1);
  assert.equal(invites.byToken('c').revoked_at, at);
});
