import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { olderHref, startApp } from '../helpers/http.js';
import { seedGallery } from '../helpers/gallery-seed.js';
import { PATHS } from '../../config/urls.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

async function seedWorld() {
  const alice = await app.signedIn({ displayName: 'Alice Alpha' });
  const bob = await app.signedIn({ displayName: 'Bob Beta' });
  const admin = await app.signedIn({ role: 'admin', displayName: 'Ada Admin' });
  const aliceGallery = seedGallery(app.context, alice.user.id, { title: 'Alice Trip' });
  const bobGallery = seedGallery(app.context, bob.user.id, { title: 'Bob Secret' });
  const { activityService: a } = app.context;
  const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
  a.record({ kind: 'linkShared', actor: alice.user, gallery: { id: aliceGallery, title: 'Alice Trip' } });
  a.record({
    kind: 'galleryVisited',
    actor: 'visitor',
    subject: alice.user,
    gallery: { id: aliceGallery, title: 'Alice Trip' },
    ip: '198.51.100.24',
    userAgent: ua,
  });
  a.record({
    kind: 'galleryDetailsChanged',
    actor: admin.user,
    subject: alice.user,
    gallery: { id: aliceGallery, title: 'Alice Trip' },
    details: 'title',
  });
  a.record({ kind: 'linkShared', actor: bob.user, gallery: { id: bobGallery, title: 'Bob Secret' } });
  a.record({
    kind: 'galleryVisited',
    actor: 'visitor',
    subject: bob.user,
    gallery: { id: bobGallery, title: 'Bob Secret' },
    ip: '203.0.113.99',
    userAgent: ua,
  });
  a.record({ kind: 'signInFailed', actor: 'visitor', details: 'nobody@example.com', ip: '192.0.2.66' });
  a.record({ kind: 'settingChanged', actor: admin.user, details: 'Max image size: 25 to 40' });
  a.record({ kind: 'serverStarted', actor: 'system' });
  return { alice, bob, admin, aliceGallery, bobGallery };
}

test('admin Activity lists every event newest first with When, Who, Area, What, Details, From and pill tones by event', async () => {
  const { admin } = await seedWorld();
  const { res, html } = await admin.get(PATHS.admin.activity);
  assert.equal(res.status, 200);
  for (const head of ['When', 'Who', 'Area', 'What', 'Details', 'From'])
    assert.match(html, new RegExp(`<th[^>]*>${head}</th>`));
  assert.match(html, /Alice Alpha/);
  assert.match(html, /Bob Beta/);
  assert.match(html, /Ada Admin/);
  assert.match(html, /198\.51\.100\.24 · Firefox/);
  assert.match(html, /203\.0\.113\.99/);
  assert.match(html, /192\.0\.2\.66/);
  assert.match(html, /Newest first · kept 90 days/);
  assert.ok(html.indexOf('Server started') < html.indexOf('Link shared'), 'newest first');
  const pillOf = (what) =>
    (html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [])
      .find((row) => row.includes(`>${what}</td>`))
      ?.match(/<span class="pill[^"]*">[^<]*<\/span>/)?.[0];
  assert.equal(pillOf('Link shared'), '<span class="pill pill-green">Sharing</span>');
  assert.equal(pillOf('Server started'), '<span class="pill pill-green">System</span>');
  assert.equal(pillOf('Gallery details changed'), '<span class="pill pill-amber">Galleries</span>');
  assert.equal(pillOf('Setting changed'), '<span class="pill pill-amber">Settings</span>');
  assert.equal(pillOf('Sign-in failed'), '<span class="pill pill-red">Security</span>');
  assert.equal(pillOf('Gallery visited'), '<span class="pill pill-sky">Sharing</span>');
  assert.match(html, /aria-current="page"[^>]*>[\s\S]{0,200}Activity/);
});

test('admin Activity filters by person (actor or subject), area and gallery; unknown values show everything', async () => {
  const { admin, alice, bob, aliceGallery } = await seedWorld();
  const byPerson = (await admin.get(`${PATHS.admin.activity}?person_id=${alice.user.id}`)).html;
  assert.match(byPerson, /Alice Trip/);
  assert.doesNotMatch(byPerson, /203\.0\.113\.99/);
  assert.match(byPerson, /198\.51\.100\.24/, 'visit of her gallery has her as subject');
  const byArea = (await admin.get(`${PATHS.admin.activity}?area=security`)).html;
  assert.match(byArea, /Sign-in failed/);
  assert.doesNotMatch(byArea, /Link shared/);
  const byGallery = (await admin.get(`${PATHS.admin.activity}?gallery_id=${aliceGallery}`)).html;
  assert.match(byGallery, /198\.51\.100\.24/);
  assert.doesNotMatch(byGallery, /203\.0\.113\.99/);
  assert.match(byGallery, new RegExp(`<option value="${aliceGallery}" selected`));
  for (const query of ['person_id=abc', 'area=nope', 'gallery_id=-3', 'before_id=zzz', 'person_id=99999999']) {
    const { res, html } = await admin.get(`${PATHS.admin.activity}?${query}`);
    assert.equal(res.status, 200, query);
    if (!query.includes('99999999')) assert.match(html, /Alice Trip/, query);
  }
  assert.ok(bob);
});

test('admin Activity filters reach deleted users, deleted and trashed galleries, marked as such', async () => {
  const { admin } = await seedWorld();
  const dee = await app.signedIn({ displayName: 'Dee Gone' });
  const goneGallery = seedGallery(app.context, dee.user.id, { title: 'Dee Lost Trip' });
  const ella = await app.signedIn({ displayName: 'Ella Here' });
  const trashedGallery = seedGallery(app.context, ella.user.id, { title: 'Ella Binned' });
  const { activityService: a, users, galleries } = app.context;
  a.record({ kind: 'linkShared', actor: dee.user, gallery: { id: goneGallery, title: 'Dee Lost Trip' } });
  a.record({ kind: 'linkShared', actor: ella.user, gallery: { id: trashedGallery, title: 'Ella Binned' } });
  users.remove(dee.user.id);
  galleries.trashById(trashedGallery);

  const { html } = await admin.get(PATHS.admin.activity);
  assert.match(html, new RegExp(`<option value="${dee.user.id}"[^>]*>\\s*Dee Gone \\(deleted\\)`));
  assert.match(html, new RegExp(`<option value="${goneGallery}"[^>]*>\\s*Dee Lost Trip \\(deleted\\)`));
  assert.match(html, new RegExp(`<option value="${trashedGallery}"[^>]*>\\s*Ella Binned \\(in Trash\\)`));
  assert.match(html, new RegExp(`<option value="${ella.user.id}"[^>]*>\\s*Ella Here\\s*<`));

  const byPerson = (await admin.get(`${PATHS.admin.activity}?person_id=${dee.user.id}`)).html;
  assert.match(byPerson, /\u201cDee Lost Trip\u201d/, 'the row itself, not just the option');
  assert.doesNotMatch(byPerson, /198\.51\.100\.24/, 'the deleted user is a working filter');
  const byGallery = (await admin.get(`${PATHS.admin.activity}?gallery_id=${trashedGallery}`)).html;
  assert.match(byGallery, /\u201cElla Binned\u201d/, 'the row itself, not just the option');
  assert.doesNotMatch(byGallery, /198\.51\.100\.24/, 'the trashed gallery is a working filter');
});

test("My activity offers only the galleries in the user's own events", async () => {
  const { alice, aliceGallery, bobGallery } = await seedWorld();
  const quiet = seedGallery(app.context, alice.user.id, { title: 'Alice Quiet' });
  const { html } = await alice.get(PATHS.activity);
  assert.match(html, new RegExp(`<option value="${aliceGallery}"`));
  assert.doesNotMatch(html, new RegExp(`<option value="${bobGallery}"`));
  assert.doesNotMatch(html, new RegExp(`<option value="${quiet}"`), 'a gallery with no events is not offered');
});

test('admin Activity pages with "Older activity" using before_id and keeps the filters in the link', async () => {
  const admin = await app.signedIn({ role: 'admin' });
  const size = app.context.effectiveConfigService.pageSize().value;
  for (let n = 0; n < size + 3; n++) {
    app.context.activityService.record({ kind: 'signInFailed', actor: 'visitor', details: `probe-${n}` });
  }
  const first = (await admin.get(`${PATHS.admin.activity}?area=security`)).html;
  const href = olderHref(first);
  assert.ok(href, 'older link');
  assert.match(href, /area=security/);
  assert.match(href, /before_id=\d+/);
  const second = (await admin.get(href)).html;
  assert.match(second, /probe-0/);
  assert.doesNotMatch(second, /probe-\d+[^]*Older activity/);
  assert.equal(olderHref(second), null);
});

test('a non-admin gets 404 on Admin → Activity', async () => {
  const user = await app.signedIn();
  assert.equal((await user.get(PATHS.admin.activity)).res.status, 404);
});

test("My activity shows only the user's own and their galleries' events, as You / Visitor / An admin, with no From column and no Security or System rows", async () => {
  const { alice } = await seedWorld();
  const { res, html } = await alice.get(PATHS.activity);
  assert.equal(res.status, 200);
  for (const head of ['When', 'Who', 'Area', 'What', 'Details'])
    assert.match(html, new RegExp(`<th[^>]*>${head}</th>`));
  assert.doesNotMatch(html, /<th[^>]*>From<\/th>/);
  assert.match(html, /\u201cAlice Trip\u201d/);
  assert.match(html, />You</);
  assert.match(html, />Visitor</);
  assert.match(html, />An admin</);
  assert.match(html, /Newest first · kept 90 days/);
  for (const secret of [
    'Bob Secret',
    'Bob Beta',
    'Ada Admin',
    '198.51.100.24',
    '203.0.113.99',
    '192.0.2.66',
    'Firefox',
    'Sign-in failed',
    'Server started',
    'Setting changed',
    'nobody@example.com',
  ]) {
    assert.ok(!html.includes(secret), `must not show ${secret}`);
  }
  assert.doesNotMatch(html, /<option[^>]*>(Security|System)</);
  assert.doesNotMatch(html, /name="person_id"/);
});

test("?gallery_id= of another user's gallery shows nothing of it; ?person_id= and ?area=security are ignored or empty", async () => {
  const { alice, bob, bobGallery } = await seedWorld();
  const other = await alice.get(`${PATHS.activity}?gallery_id=${bobGallery}`);
  assert.equal(other.res.status, 200);
  for (const secret of ['Bob Secret', 'Bob Beta', '203.0.113.99']) {
    assert.ok(!other.html.includes(secret), `must not show ${secret}`);
  }
  assert.doesNotMatch(other.html, new RegExp(`value="${bobGallery}"`));
  const person = (await alice.get(`${PATHS.activity}?person_id=${bob.user.id}`)).html;
  assert.ok(!person.includes('Bob Secret') && !person.includes('Bob Beta'));
  assert.match(person, /Alice Trip/, 'person_id is ignored, own events still show');
  const security = (await alice.get(`${PATHS.activity}?area=security`)).html;
  assert.ok(!security.includes('Sign-in failed') && !security.includes('192.0.2.66'));
  const system = (await alice.get(`${PATHS.activity}?area=system`)).html;
  assert.ok(!system.includes('Server started'));
});

test('My activity shows an empty state when there is nothing', async () => {
  const fresh = await app.signedIn();
  const { html } = await fresh.get(`${PATHS.activity}?area=sharing`);
  assert.match(html, /No activity/);
});
