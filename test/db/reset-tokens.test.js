import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertBareUser } from '../helpers/accounts.js';
import { freshDb } from '../helpers/db.js';
import { fakeClock } from '../helpers/clock.js';
import { createResetTokensRepository } from '../../db/reset-tokens.repository.js';

test('reset tokens stamp times from the injected clock', () => {
  const db = freshDb();
  const at = '2026-03-04T05:06:07.000Z';
  const { now } = fakeClock(at);
  const uid = insertBareUser(db);
  const expiresAt = '2026-04-01T00:00:00.000Z';
  const resetTokens = createResetTokensRepository(db, { now });
  const resetId = resetTokens.insert({ userId: uid, token: 'r', createdBy: null, expiresAt });
  assert.equal(resetTokens.byToken('r').created_at, at);
  assert.equal(resetTokens.markUsed(resetId), true);
  assert.equal(resetTokens.byToken('r').used_at, at);
});
