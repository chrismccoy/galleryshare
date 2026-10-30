import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  countAttr,
  elementByAttr,
  elementsByAttr,
  elementsByTag,
  navCount,
  startApp,
  statValue,
  textOf,
} from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { assertSignInRedirect } from '../helpers/assertions.js';
import { PATHS } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('dashboard routes require sign-in', async () => {
  await assertSignInRedirect(app, PATHS.dashboard);
});

test('the dashboard shows the empty state with a Add gallery link', async () => {
  const s = await app.signedIn();
  const { res, html } = await app.get(s, '/dashboard');
  assert.equal(res.status, 200);
  assert.match(html, /No galleries yet\./);
  assert.match(html, /href="\/dashboard\/galleries\/new"/);
  assert.match(html, /href="\/dashboard\/galleries"/);
});

test('admins see the same dashboard and the admin navigation', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const { res, html } = await app.get(admin, '/dashboard');
  assert.equal(res.status, 200);
  assert.match(html, /No galleries yet\./);
  assert.match(html, /href="\/admin\/galleries"/);
  assert.match(html, /href="\/admin\/shares"/);
});

test('the dashboard shows counts and the six most recent galleries', async () => {
  const s = await app.signedIn();
  for (let i = 0; i < 7; i++) seedGallery(app.context, s.user.id, { title: `Card${i}`, images: 2, bytes: 1024 * 1024 });
  const other = await app.signedIn();
  seedGallery(app.context, other.user.id, { title: 'NotMine', images: 5 });
  const trashed = seedGallery(app.context, s.user.id, { title: 'Trashed', images: 1 });
  app.context.galleries.trashOwned(trashed, s.user.id);
  const { html } = await app.get(s, '/dashboard');
  assert.equal(statValue(html, 'galleries'), '7');
  assert.equal(statValue(html, 'images'), '14');
  assert.equal(statValue(html, 'storage'), '14.0 MB');
  assert.equal(countAttr(html, 'data-gallery-card'), 6);
  assert.match(html, /Card6/);
  assert.doesNotMatch(html, /Card0|NotMine|Trashed/);
  assert.match(html, /\/media\/\d+\/thumb/);
  assert.doesNotMatch(html, /No galleries yet\./);
});

test('the Live links tile counts live shares of galleries not in Trash, and cards carry the Shared pill', async () => {
  const s = await app.signedIn();
  const shared = seedGallery(app.context, s.user.id, { title: 'SharedOne', images: 1 });
  seedGallery(app.context, s.user.id, { title: 'PlainOne', images: 1 });
  const pausedId = seedGallery(app.context, s.user.id, { title: 'Paused', images: 1 });
  const revokedId = seedGallery(app.context, s.user.id, { title: 'Revoked', images: 1 });
  app.context.sharesService.share(s.user, shared);
  app.context.sharesService.share(s.user, pausedId);
  app.context.sharesService.share(s.user, revokedId);
  app.context.sharesService.revokeFor(s.user, revokedId);
  app.context.galleries.trashOwned(pausedId, s.user.id);
  const other = await app.signedIn();
  app.context.sharesService.share(other.user, seedGallery(app.context, other.user.id));

  const { html } = await app.get(s, '/dashboard');
  assert.equal(statValue(html, 'shares'), '1');
  assert.match(textOf(elementByAttr(html, 'data-stat', 'shares')), /Live links/);
  const cards = elementsByAttr(html, 'data-gallery-card');
  const card = (title) => {
    const found = cards.filter((c) => c.includes(`>${title}<`));
    assert.equal(found.length, 1, `one card titled ${title}`);
    return found[0];
  };
  assert.ok(card('SharedOne').includes('data-shared-pill'), 'shared card has the pill');
  assert.ok(!card('PlainOne').includes('data-shared-pill'), 'unshared card has none');
  assert.ok(!card('Revoked').includes('data-shared-pill'), 'revoked card has none');
});

test('admins see the live share count on the Shared links nav badge', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const { html } = await app.get(admin, '/dashboard');
  const expected = app.context.sharesService.countLive();
  assert.equal(navCount(html, 'shares'), String(expected));
});

test("the dashboard shows the user's five latest My activity entries, newest first, with a link to all", async () => {
  const s = await app.signedIn();
  const other = await app.signedIn();
  const { activityService } = app.context;
  for (let i = 1; i <= 6; i++) {
    activityService.record({ kind: 'linkShared', actor: s.user, gallery: { id: 900 + i, title: `Trip ${i}` } });
  }
  activityService.record({ kind: 'linkShared', actor: other.user, gallery: { id: 999, title: 'Not mine' } });
  activityService.record({ kind: 'signInFailed', actor: 'visitor', details: 'x@example.com', ip: '192.0.2.9' });
  const { html } = await app.get(s, '/dashboard');
  const card = elementByAttr(html, 'data-widget', 'activity');
  assert.ok(card, 'the Recent activity card is drawn');
  assert.match(textOf(card), /Recent activity/);
  assert.match(card, /href="\/dashboard\/activity"/);
  const rows = elementsByTag(card, 'tr').slice(1).map(textOf);
  assert.equal(rows.length, 5);
  assert.match(rows[0], /Link shared.*Trip 6/);
  assert.match(rows[4], /Trip 2/);
  assert.ok(!card.includes('Not mine') && !card.includes('Sign-in failed') && !card.includes('192.0.2.9'));
  assert.ok(!/<th[^>]*>From<\/th>/.test(card), 'no From column');
});

test('a user with no activity sees the empty state in the Recent activity card', async () => {
  const mark = app.context.activity.lastId();
  const s = await app.signedIn();
  app.context.activity.deleteAfter(mark);
  const card = elementByAttr((await app.get(s, '/dashboard')).html, 'data-widget', 'activity');
  assert.match(textOf(card), /No activity yet\./);
});
