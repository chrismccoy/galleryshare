import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, rowCount } from '../helpers/db.js';
import { fakeClock, later } from '../helpers/clock.js';
import { insertBareUser, openSession } from '../helpers/accounts.js';
import { createSessionsRepository } from '../../db/sessions.repository.js';
import { hashToken } from '../../lib/tokens.js';

test('sessions.find ignores expired', () => {
  const db = freshDb();
  const uid = insertBareUser(db);
  const clock = fakeClock('2026-01-01T00:00:00Z');
  const sessions = createSessionsRepository(db, { now: clock.now });
  const { token, csrfToken } = openSession(sessions, { userId: uid, expiresAt: new Date('2026-01-02T00:00:00Z') });
  assert.equal(sessions.liveByToken(token).csrf_token, csrfToken);
  assert.equal(sessions.liveByToken('nope'), null);
  clock.set('2026-01-03T00:00:00Z');
  assert.equal(sessions.liveByToken(token), null);
  sessions.sweep();
  assert.equal(rowCount(db, 'sessions'), 0);
});

test('sessions.remove and removeForUser kills all sessions', () => {
  const db = freshDb();
  const uid = insertBareUser(db);
  const sessions = createSessionsRepository(db, fakeClock('2026-01-01T00:00:00Z'));
  const exp = '2026-02-01T00:00:00.000Z';
  const a = openSession(sessions, { userId: uid, expiresAt: exp });
  const b = openSession(sessions, { userId: uid, expiresAt: exp });
  const c = openSession(sessions, { userId: uid, expiresAt: exp });
  sessions.remove(a.token);
  assert.equal(sessions.liveByToken(a.token), null);
  sessions.removeForUser(uid);
  assert.equal(sessions.liveByToken(b.token), null);
  assert.equal(sessions.liveByToken(c.token), null);
});

test('sessions stamp created_at from the injected clock', () => {
  const db = freshDb();
  const at = '2001-02-03T04:05:06.000Z';
  const { now } = fakeClock(at);
  const uid = insertBareUser(db);
  const sessions = createSessionsRepository(db, { now });
  const { token } = openSession(sessions, { userId: uid, expiresAt: new Date('2001-03-01T00:00:00.000Z') });
  assert.equal(db.prepare('SELECT created_at FROM sessions WHERE token_hash = ?').get(hashToken(token)).created_at, at);
});

test('sessions store only the hash of the token; the cookie value still finds and ends the session', () => {
  const db = freshDb();
  const uid = insertBareUser(db, { email: 'h@x.co' });
  const sessions = createSessionsRepository(db);
  const { token } = openSession(sessions, { userId: uid, expiresAt: later() });
  const stored = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(uid).token_hash;
  assert.notEqual(stored, token);
  assert.equal(stored, hashToken(token));
  assert.equal(sessions.liveByToken(stored), null, 'the stored hash is not a usable cookie');
  assert.equal(sessions.liveByToken(token).user_id, uid);
  assert.equal(sessions.remove(token), true);
  assert.equal(sessions.liveByToken(token), null);
});
