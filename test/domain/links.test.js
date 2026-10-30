import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkLookup, linkProblem, linkStatus } from '../../domain/links.js';
import { ValidationError } from '../../lib/errors.js';
import { isPublicError } from '../helpers/assertions.js';

const NOW = '2026-10-28T12:00:00.000Z';

test('linkStatus: revoked beats used beats expired beats pending', () => {
  const later = '2026-11-01T00:00:00.000Z';
  const earlier = '2026-10-01T00:00:00.000Z';
  assert.equal(linkStatus({ revoked_at: NOW, used_at: NOW, expires_at: earlier }, NOW), 'revoked');
  assert.equal(linkStatus({ used_at: NOW, expires_at: earlier }, NOW), 'used');
  assert.equal(linkStatus({ used_at: null, expires_at: earlier }, NOW), 'expired');
  assert.equal(linkStatus({ used_at: null, expires_at: later }, NOW), 'pending');
});

test('linkProblem words each state for both kinds and is null for a usable link', () => {
  assert.equal(linkProblem('invite', 'revoked'), 'This invite link has been revoked.');
  assert.equal(linkProblem('reset', 'used'), 'This reset link has already been used.');
  assert.equal(linkProblem('reset', 'expired'), 'This reset link has expired.');
  assert.equal(linkProblem('invite', 'invalid'), 'This invite link is not valid.');
  assert.equal(linkProblem('invite', 'pending'), null);
});

test('createLinkLookup: requireUsable returns a pending row and throws the problem otherwise; refuse comes first', () => {
  const rows = {
    ok: { id: 1, user_id: 7, used_at: null, expires_at: '2026-11-01T00:00:00.000Z' },
    used: { id: 2, user_id: 7, used_at: NOW, expires_at: '2026-11-01T00:00:00.000Z' },
    blocked: { id: 3, user_id: 9, used_at: null, expires_at: '2026-11-01T00:00:00.000Z' },
  };
  const links = createLinkLookup({
    byToken: (token) => rows[token] ?? null,
    kind: 'reset',
    nowIso: () => NOW,
    refuse: (row) => (row.user_id === 9 ? 'Not this account.' : null),
  });
  assert.equal(links.requireUsable('ok'), rows.ok);
  const refusal = (message) => isPublicError(ValidationError, message);
  assert.throws(() => links.requireUsable('used'), refusal('This reset link has already been used.'));
  assert.throws(() => links.requireUsable('nope'), refusal('This reset link is not valid.'));
  assert.throws(() => links.requireUsable('blocked'), refusal('Not this account.'));
  assert.equal(links.problemForToken('blocked'), 'Not this account.');
  assert.equal(links.problemForRow(null), 'This reset link is not valid.');
  assert.equal(links.problemForToken('ok'), null);
  assert.equal('check' in links, false, 'no separate pending-row lookup: requireUsable and problemForToken cover it');
});
