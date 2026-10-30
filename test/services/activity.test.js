import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, insertUser } from '../helpers/context.js';
import { recordingLogger } from '../helpers/logger.js';
import { createActivityService } from '../../services/activity.service.js';
import { MS_PER_DAY, isoAfter } from '../../lib/time.js';

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function setup() {
  const rec = recordingLogger();
  const { context, db } = buildContext({ logger: rec.logger });
  const ana = await insertUser(context, { email: 'ana@example.com', displayName: 'Ana Ribeiro' });
  const chris = await insertUser(context, { email: 'chris@example.com', role: 'admin' });
  const bob = await insertUser(context, { email: 'bob@example.com' });
  return { context, db, rec, ana, chris, bob, service: context.activityService };
}

test('record stores names and titles, so rows read the same after the user and gallery are deleted', async () => {
  const { context, db, service, ana, chris } = await setup();
  const galleryId = context.galleriesService.create(ana);
  service.record({
    kind: 'linkShared',
    actor: ana,
    subject: ana,
    gallery: { id: galleryId, title: 'Lisbon in October' },
  });
  service.record({ kind: 'userDisabled', actor: chris.id, subject: ana.id });
  db.prepare('DELETE FROM galleries WHERE id = ?').run(galleryId);
  db.prepare('DELETE FROM users WHERE id = ?').run(ana.id);
  const rows = service.listForAdmin({ limit: 10 });
  assert.equal(rows[1].who, 'Ana Ribeiro');
  assert.equal(rows[1].galleryId, galleryId);
  const stored = context.activity.list({ limit: 10 });
  assert.equal(stored[1].gallery_title, 'Lisbon in October');
  assert.equal(stored[0].subject_name, 'Ana Ribeiro');
  assert.equal(stored[0].actor_name, 'chris');
});

test('record resolves ids; a missing user keeps the id with no name', async () => {
  const { context, service } = await setup();
  service.record({ kind: 'userDeleted', actor: 9999, subject: 8888 });
  const [r] = context.activity.list({ limit: 1 });
  assert.deepEqual([r.actor_id, r.actor_name, r.subject_user_id, r.subject_name], [9999, null, 8888, null]);
});

test('record stores a missing actor, undefined or null, as the system', async () => {
  const { context, service, ana } = await setup();
  service.record({ kind: 'userDisabled', subject: ana });
  service.record({ kind: 'userEnabled', actor: null, subject: ana });
  for (const row of context.activity.list({ limit: 2 })) {
    assert.deepEqual([row.actor_type, row.actor_id, row.actor_name], ['system', null, null], row.kind);
  }
});

test('record logs one info line "Link shared" with a summary naming the gallery and actor', async () => {
  const { service, rec, ana } = await setup();
  service.record({ kind: 'linkShared', actor: ana, subject: ana, gallery: { id: 7, title: 'Lisbon in October' } });
  assert.equal(rec.info.length, 1);
  const [message, fields] = rec.info[0];
  assert.equal(message, 'Link shared');
  assert.equal(fields.summary, '"Lisbon in October" by ana@example.com');
  assert.deepEqual(
    [fields.area, fields.kind, fields.galleryId, fields.actorId, fields.subjectUserId],
    ['sharing', 'linkShared', 7, ana.id, ana.id],
  );
});

test('a failed sign-in logs the email and address, and no more', async () => {
  const { service, rec } = await setup();
  service.record({ kind: 'signInFailed', actor: 'visitor', details: 'bob@example.com', ip: '203.0.113.7' });
  assert.equal(rec.info[0][1].summary, 'bob@example.com from 203.0.113.7');
  assert.equal(rec.info[0][0], 'Sign-in failed');
});

test('record never throws: a failing insert is logged as a warning, and the event gets no info line', async () => {
  const { context, rec } = await setup();
  const service = createActivityService({
    activity: {
      insert() {
        throw new Error('disk full');
      },
    },
    users: context.users,
    logger: rec.logger,
    now: context.now,
  });
  assert.doesNotThrow(() => service.record({ kind: 'serverStarted', actor: 'system' }));
  assert.equal(rec.warn.length, 1);
  assert.equal(rec.warn[0][0], 'activity not recorded');
  assert.equal(rec.warn[0][1].kind, 'serverStarted');
  assert.match(rec.warn[0][1].error, /disk full/);
  assert.deepEqual(rec.info, [], 'an event that was not stored is not logged as if it happened');
});

test('an unknown kind throws', async () => {
  const { service } = await setup();
  assert.throws(() => service.record({ kind: 'nope' }), /Unknown activity kind/);
});

test('user agents and details longer than 300 characters are stored cut to 300, and the console summary has no newlines', async () => {
  const { context, service, rec } = await setup();
  service.record({
    kind: 'galleryVisited',
    actor: 'visitor',
    details: `a\nb${'x'.repeat(5000)}`,
    userAgent: 'u'.repeat(5000),
    ip: '1.1.1.1',
  });
  const [r] = context.activity.list({ limit: 1 });
  assert.equal(r.details.length, 300);
  assert.equal(r.user_agent.length, 300);
  assert.doesNotMatch(rec.info[0][1].summary, /\n/);
  assert.ok(rec.info[0][1].summary.length < 400);
});

test('listForUser shows "You", "Visitor" and "An admin", and no from', async () => {
  const { service, ana, chris, bob } = await setup();
  service.record({ kind: 'galleryCreated', actor: ana });
  service.record({ kind: 'galleryVisited', actor: 'visitor', subject: ana, ip: '9.9.9.9', userAgent: CHROME });
  service.record({ kind: 'userDisabled', actor: chris, subject: ana });
  service.record({ kind: 'galleryCreated', actor: bob });
  service.record({ kind: 'signInFailed', actor: 'visitor', subject: ana, ip: '9.9.9.9' });
  service.record({ kind: 'serverStarted', actor: 'system', subject: ana });
  const rows = service.listForUser(ana, { limit: 10 });
  assert.deepEqual(
    rows.map((r) => r.who),
    ['An admin', 'Visitor', 'You'],
  );
  assert.ok(rows.every((r) => r.from === null));
  assert.ok(!JSON.stringify(rows).includes('chris'));
  assert.ok(!JSON.stringify(rows).includes('9.9.9.9'));
});

test('listForAdmin shows names and from', async () => {
  const { service, ana, chris } = await setup();
  service.record({ kind: 'userDisabled', actor: chris, subject: ana });
  service.record({ kind: 'galleryVisited', actor: 'visitor', ip: '9.9.9.9', userAgent: CHROME });
  service.record({ kind: 'serverStarted', actor: 'system' });
  service.record({ kind: 'signedIn', actor: ana, ip: '1.2.3.4' });
  const rows = service.listForAdmin({ limit: 10 });
  assert.deepEqual(
    rows.map((r) => [r.who, r.from, r.what]),
    [
      ['Ana Ribeiro', '1.2.3.4', 'Signed in'],
      ['System', null, 'Server started'],
      ['Visitor', '9.9.9.9 · Chrome', 'Gallery visited'],
      ['chris', null, 'User disabled'],
    ],
  );
  assert.deepEqual(Object.keys(rows[0]), [
    'id',
    'when',
    'who',
    'area',
    'kind',
    'what',
    'details',
    'from',
    'galleryId',
    'galleryTitle',
  ]);
});

test('purgeBefore deletes rows recorded before the cutoff', async () => {
  const { service } = await setup();
  service.record({ kind: 'serverStarted' });
  assert.equal(service.purgeBefore('2001-01-01T00:00:00.000Z'), 0, 'the row is newer than the cutoff');
  assert.equal(service.purgeBefore(isoAfter(new Date(), MS_PER_DAY)), 1, 'the row is older than the cutoff');
  assert.equal(service.purgeBefore(isoAfter(new Date(), MS_PER_DAY)), 0, 'nothing is left');
});

test('a blank display name falls back to the email in the stored name', async () => {
  const { context, service } = await setup();
  const blank = await insertUser(context, { email: 'blank@example.com', displayName: ' ' });
  service.record({ kind: 'signedIn', actor: blank });
  assert.equal(context.activity.list({ limit: 1 })[0].actor_name, 'blank@example.com');
});

test('control characters (an ESC sequence) in a typed email or title never reach the console summary', async () => {
  const { service, rec } = await setup();
  service.record({ kind: 'signInFailed', actor: 'visitor', details: 'x\x1b[31m@evil\x07.test', ip: '1.1.1.1' });
  service.record({ kind: 'galleryCreated', actor: 'visitor', gallery: { id: 1, title: 'T\x1b]0;pwn\x07itle\x7f' } });
  for (const [, fields] of rec.info) assert.doesNotMatch(fields.summary, /[\x00-\x1f\x7f]/);
});

test('an address longer than 300 characters is stored cut to 300', async () => {
  const { context, service } = await setup();
  service.record({ kind: 'signInFailed', actor: 'visitor', details: 'a@b.c', ip: '9'.repeat(5000) });
  assert.equal(context.activity.list({ limit: 1 })[0].ip.length, 300);
});
