import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/db.js';
import { activityListSql, createActivityRepository } from '../../db/activity.repository.js';
import { fakeClock } from '../helpers/clock.js';

function setup() {
  const clock = fakeClock('2026-10-28T10:00:00.000Z');
  return { activity: createActivityRepository(freshDb(), { now: clock.now }), clock };
}

const row = (over = {}) => ({ area: 'galleries', kind: 'galleryCreated', actorType: 'user', actorId: 1, ...over });

test('list is newest first and pages by beforeId', () => {
  const { activity } = setup();
  const ids = [1, 2, 3, 4, 5].map(() => activity.insert(row()));
  assert.deepEqual(
    activity.list({ limit: 2 }).map((r) => r.id),
    [ids[4], ids[3]],
  );
  assert.deepEqual(
    activity.list({ beforeId: ids[3], limit: 10 }).map((r) => r.id),
    [ids[2], ids[1], ids[0]],
  );
});

test('insert stamps the time from the clock and stores every column', () => {
  const { activity } = setup();
  activity.insert(
    row({
      actorName: 'a',
      subjectUserId: 2,
      subjectName: 'b',
      galleryId: 9,
      galleryTitle: 'T',
      details: 'd',
      ip: '1.2.3.4',
      userAgent: 'ua',
    }),
  );
  const [r] = activity.list({ limit: 1 });
  assert.equal(r.at, '2026-10-28T10:00:00.000Z');
  assert.deepEqual(
    [r.actor_name, r.subject_user_id, r.subject_name, r.gallery_id, r.gallery_title, r.details, r.ip, r.user_agent],
    ['a', 2, 'b', 9, 'T', 'd', '1.2.3.4', 'ua'],
  );
});

test('personId matches the actor or the subject', () => {
  const { activity } = setup();
  const own = activity.insert(row({ actorId: 1 }));
  const about = activity.insert(row({ actorId: 2, subjectUserId: 1 }));
  activity.insert(row({ actorId: 3 }));
  assert.deepEqual(
    activity
      .list({ limit: 10, personId: 1 })
      .map((r) => r.id)
      .sort(),
    [own, about],
  );
});

test('area and galleryId filter', () => {
  const { activity } = setup();
  const a = activity.insert(row({ area: 'sharing', galleryId: 5 }));
  activity.insert(row({ area: 'settings', galleryId: 6 }));
  assert.deepEqual(
    activity.list({ limit: 10, area: 'sharing' }).map((r) => r.id),
    [a],
  );
  assert.deepEqual(
    activity.list({ limit: 10, galleryId: 5 }).map((r) => r.id),
    [a],
  );
});

test('viewerId shows own actions and actions on the viewer, never others, never security or system', () => {
  const { activity } = setup();
  const own = activity.insert(row({ actorId: 1 }));
  const visit = activity.insert(row({ area: 'sharing', actorType: 'visitor', actorId: null, subjectUserId: 1 }));
  const byAdmin = activity.insert(row({ actorId: 9, subjectUserId: 1 }));
  activity.insert(row({ actorId: 2 }));
  activity.insert(row({ actorType: 'visitor', actorId: null, subjectUserId: 2 }));
  activity.insert(row({ area: 'security', actorId: 1 }));
  activity.insert(row({ area: 'security', actorType: 'visitor', actorId: null, subjectUserId: 1 }));
  activity.insert(row({ area: 'system', actorType: 'system', actorId: null, subjectUserId: 1 }));
  activity.insert(row({ actorType: 'visitor', actorId: 1 }));
  assert.deepEqual(
    activity
      .list({ limit: 50, viewerId: 1 })
      .map((r) => r.id)
      .sort(),
    [own, visit, byAdmin],
  );
});

test('purgeBefore removes only older rows and returns the count', () => {
  const { activity, clock } = setup();
  activity.insert(row());
  clock.tick(10 * 86_400_000);
  const fresh = activity.insert(row());
  assert.equal(activity.purgeBefore('2026-11-01T00:00:00.000Z'), 1);
  assert.deepEqual(
    activity.list({ limit: 10 }).map((r) => r.id),
    [fresh],
  );
});

test('each filter is answered from its index, not a table scan', () => {
  const db = freshDb();
  const plan = (used) => {
    const params = Object.fromEntries(Object.keys(used).map((name) => [name, name === 'area' ? 'sharing' : 1]));
    return db
      .prepare(`EXPLAIN QUERY PLAN ${activityListSql(used)}`)
      .all({ ...params, limit: 25 })
      .map((step) => step.detail)
      .join('\n');
  };
  assert.match(plan({ person: true }), /idx_activity_actor[\s\S]*idx_activity_subject/);
  assert.match(plan({ viewer: true, before: true }), /idx_activity_actor[\s\S]*idx_activity_subject/);
  assert.match(plan({ gallery: true, before: true }), /idx_activity_gallery \(gallery_id=\? AND id<\?\)/);
  assert.match(plan({ area: true }), /idx_activity_area/);
  for (const used of [{ person: true }, { viewer: true }, { gallery: true }, { area: true }]) {
    assert.doesNotMatch(plan(used), /SCAN activity\b/);
  }
});

test('filters combine with AND and the cursor', () => {
  const { activity } = setup();
  const a = activity.insert(row({ actorId: 1, galleryId: 7, area: 'sharing', kind: 'linkShared' }));
  activity.insert(row({ actorId: 2, galleryId: 7, area: 'sharing', kind: 'linkShared' }));
  activity.insert(row({ actorId: 1, galleryId: 8, area: 'sharing', kind: 'linkShared' }));
  const d = activity.insert(row({ actorId: 1, galleryId: 7, area: 'sharing', kind: 'linkShared' }));
  assert.deepEqual(
    activity.list({ personId: 1, galleryId: 7, area: 'sharing', limit: 10 }).map((r) => r.id),
    [d, a],
  );
  assert.deepEqual(
    activity.list({ personId: 1, galleryId: 7, beforeId: d, limit: 10 }).map((r) => r.id),
    [a],
  );
});

test('filterValues lists each person and gallery once, with the name from its latest event', () => {
  const { activity } = setup();
  activity.insert(row({ actorId: 1, actorName: 'Old Name', galleryId: 7, galleryTitle: 'Old Title' }));
  activity.insert(row({ actorId: 1, actorName: 'New Name', galleryId: 7, galleryTitle: 'New Title' }));
  activity.insert(row({ actorType: 'visitor', actorId: null, subjectUserId: 2, subjectName: 'Bea', galleryId: 8 }));
  const { people, galleries } = activity.filterValues();
  assert.deepEqual(
    people.sort((a, b) => a.id - b.id),
    [
      { id: 1, name: 'New Name' },
      { id: 2, name: 'Bea' },
    ],
  );
  assert.deepEqual(
    galleries.sort((a, b) => a.id - b.id),
    [
      { id: 7, title: 'New Title' },
      { id: 8, title: null },
    ],
  );
});

test("filterValues for a viewer lists only galleries in the viewer's own events, never security or system ones", () => {
  const { activity } = setup();
  activity.insert(row({ actorId: 1, galleryId: 7, galleryTitle: 'Mine' }));
  activity.insert(row({ actorType: 'visitor', actorId: null, subjectUserId: 1, galleryId: 9, area: 'sharing' }));
  activity.insert(row({ actorId: 2, galleryId: 8, galleryTitle: 'Theirs' }));
  activity.insert(row({ actorId: 1, galleryId: 6, area: 'security', kind: 'rateLimitHit' }));
  const { people, galleries } = activity.filterValues({ viewerId: 1 });
  assert.deepEqual(people, []);
  assert.deepEqual(galleries.map((g) => g.id).sort(), [7, 9]);
});

test("count gives every event, or the events of a user's own view without security and system ones", () => {
  const { activity } = setup();
  activity.insert(row({ actorId: 1 }));
  activity.insert(
    row({ actorType: 'visitor', actorId: null, subjectUserId: 1, area: 'sharing', kind: 'galleryVisited' }),
  );
  activity.insert(row({ actorId: 2 }));
  activity.insert(row({ actorId: 1, area: 'security', kind: 'rateLimitHit' }));
  activity.insert(row({ actorType: 'system', actorId: null, area: 'system', kind: 'serverStarted' }));
  assert.equal(activity.count(), 5);
  assert.equal(activity.count({ viewerId: 1 }), 2);
  assert.equal(activity.count({ viewerId: 2 }), 1);
  assert.equal(activity.count({ viewerId: 3 }), 0);
});

test("lastId and deleteAfter tell a run's rows apart and remove them", () => {
  const { activity } = setup();
  assert.equal(activity.lastId(), 0);
  activity.insert(row({ kind: 'serverStarted' }));
  const kept = activity.lastId();
  activity.insert(row({ kind: 'serverStarted' }));
  activity.insert(row({ kind: 'serverStarted' }));
  assert.equal(activity.deleteAfter(kept), 2);
  assert.equal(activity.lastId(), kept);
});
