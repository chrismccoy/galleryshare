import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS } from '../../config/urls.js';
import { avatarInitial, requestLocals } from '../../routes/middleware/request-locals.js';
import { attrsOf, elementByAttr, elementsByAttr, tagsWith, textOf, withApp } from '../helpers/http.js';
import { fakeResponse } from '../helpers/fake-response.js';
import { seedGallery } from '../helpers/gallery-seed.js';

function run(user) {
  const { res } = fakeResponse();
  requestLocals()({ user, path: '/x' }, res, () => {});
  return res.locals;
}

test('nav badge counts default to 0 without services', () => {
  const locals = run({ id: 1, role: 'admin' });
  assert.deepEqual(locals.navCounts, {
    activity: 0,
    galleries: 0,
    trash: 0,
    allActivity: 0,
    users: 0,
    invites: 0,
    allGalleries: 0,
    shares: 0,
  });
  const badges = locals.nav.flatMap((g) => g.links).filter((l) => l.badge);
  assert.deepEqual(
    badges.map((l) => [l.badge, l.count]),
    [
      ['activity', 0],
      ['galleries', 0],
      ['trash', 0],
      ['allActivity', 0],
      ['users', 0],
      ['invites', 0],
      ['allGalleries', 0],
      ['shares', 0],
    ],
  );
});

test('avatarInitial: the first whole character, upper-cased; never half a surrogate pair', () => {
  assert.equal(avatarInitial('amy'), 'A');
  assert.equal(avatarInitial('émile'), 'É');
  assert.equal(avatarInitial('😀 Smile'), '😀');
  assert.equal(avatarInitial('𝒶bc'), '𝒶');
  assert.equal(avatarInitial(''), '');
  assert.equal(avatarInitial(undefined), '');
});

test('the shares badge counts live links for admins only', () => {
  const sharesService = {
    countLive: () => 4,
  };
  const counts = (user) => {
    const { res } = fakeResponse();
    requestLocals({ sharesService })({ user, path: '/x' }, res, () => {});
    return res.locals.navCounts.shares;
  };
  assert.equal(counts({ id: 1, role: 'admin' }), 4);
  assert.equal(counts({ id: 2, role: 'user' }), 0);
  assert.equal(counts(null), 0);
});

test("the activity and galleries badges count the user's own; site-wide counts are for admins only", () => {
  const calls = [];
  const galleriesService = {
    countLive: (userId = null) => {
      calls.push(userId);
      return userId === null ? 9 : 2;
    },
    countTrashed: () => 1,
  };
  const usersService = {
    stats: () => ({ total: 5 }),
  };
  const invitesService = {
    countPending: () => 3,
  };
  const activityService = {
    countForUser: (user) => user.id * 10,
    countForAdmin: () => 400,
  };
  const counts = (user) => {
    const { res } = fakeResponse();
    requestLocals({ galleriesService, usersService, invitesService, activityService })(
      { user, path: '/x' },
      res,
      () => {},
    );
    return res.locals.navCounts;
  };
  assert.deepEqual(counts({ id: 1, role: 'admin' }), {
    activity: 10,
    galleries: 2,
    trash: 1,
    allActivity: 400,
    users: 5,
    invites: 3,
    allGalleries: 9,
    shares: 0,
  });
  assert.deepEqual(counts({ id: 2, role: 'user' }), {
    activity: 20,
    galleries: 2,
    trash: 1,
    allActivity: 0,
    users: 0,
    invites: 0,
    allGalleries: 0,
    shares: 0,
  });
  assert.deepEqual(calls, [1, null, 2], 'own count by user id; the site-wide count only for the admin');
});

test('the sidebar and the mobile strip show every count; a zero count is hidden', async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    const other = await app.signedIn();
    const mine = seedGallery(app.context, admin.user.id, { title: 'Mine one' });
    seedGallery(app.context, admin.user.id, { title: 'Mine two' });
    const theirs = seedGallery(app.context, other.user.id, { title: 'Theirs' });
    const { activityService, invitesService } = app.context;
    activityService.record({ kind: 'linkShared', actor: admin.user, gallery: { id: mine, title: 'Mine one' } });
    activityService.record({ kind: 'linkShared', actor: other.user, gallery: { id: theirs, title: 'Theirs' } });
    activityService.record({ kind: 'signInFailed', actor: 'visitor', details: 'x@example.com' });
    invitesService.create({ role: 'user', createdBy: admin.user.id });
    const revoked = invitesService.create({ role: 'user', createdBy: admin.user.id });
    invitesService.revoke(revoked.id, admin.user.id);
    const users = app.context.users.all().length;
    const all = String(app.context.activity.count());
    const badges = (html, attr) =>
      Object.fromEntries(elementsByAttr(html, attr).map((badge) => [attrsOf(badge, attr)[attr], textOf(badge)]));
    const adminPage = (await app.get(admin, PATHS.dashboard)).html;
    const sidebar = elementByAttr(adminPage, 'data-sidebar');
    const own = (user) => String(activityService.countForUser(user));
    const expected = {
      activity: own(admin.user),
      galleries: '2',
      allActivity: all,
      users: String(users),
      invites: '1',
      allGalleries: '3',
    };
    assert.deepEqual(badges(sidebar, 'data-nav-count'), expected);
    assert.deepEqual(badges(adminPage, 'data-nav-count-mobile'), expected);
    assert.ok(Number(own(admin.user)) >= 5, 'link shared, invites created and revoked count for the admin');
    assert.ok(Number(all) > Number(own(admin.user)) + Number(own(other.user)), 'the failed sign-in counts only in all');
    const userPage = (await app.get(other, PATHS.dashboard)).html;
    assert.deepEqual(
      badges(elementByAttr(userPage, 'data-sidebar'), 'data-nav-count'),
      { activity: own(other.user), galleries: '1' },
      'only their own events; no admin counts',
    );
    const mark = app.context.activity.lastId();
    const fresh = await app.signedIn();
    app.context.activity.deleteAfter(mark);
    const freshPage = (await app.get(fresh, PATHS.dashboard)).html;
    assert.deepEqual(
      badges(elementByAttr(freshPage, 'data-sidebar'), 'data-nav-count'),
      {},
      'no galleries or activity, no badge',
    );
  });
});

test('the avatar initial follows the signed-in user, empty when signed out', () => {
  assert.equal(run({ id: 1, role: 'user', display_name: 'zoe' }).avatarInitial, 'Z');
  assert.equal(run(null).avatarInitial, '');
});

test('signed out: no navigation and no badges', () => {
  const locals = run(null);
  assert.deepEqual(locals.navCounts, {
    activity: 0,
    galleries: 0,
    trash: 0,
    allActivity: 0,
    users: 0,
    invites: 0,
    allGalleries: 0,
    shares: 0,
  });
  assert.deepEqual(locals.nav, []);
});

test('the active nav link uses the path seen by the middleware, even if a mounted router rewrites req.path', () => {
  const middleware = requestLocals();
  const req = { user: { id: 1, role: 'admin' }, path: '/admin/settings' };
  const { res } = fakeResponse();
  middleware(req, res, () => {});
  req.path = '/settings';
  const active = res.locals.nav.flatMap((group) => group.links).filter((link) => link.on);
  assert.deepEqual(
    active.map((link) => link.href),
    ['/admin/settings'],
  );
});

test('admin pages mark their own sidebar link as the current page', async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    assert.equal(admin.user.role, 'admin');
    for (const path of [PATHS.admin.overview, PATHS.admin.settings, PATHS.admin.users, PATHS.dashboard]) {
      const { html } = await app.get(admin, path);
      const sidebar = elementByAttr(html, 'data-sidebar');
      const current = tagsWith(sidebar, 'aria-current', 'page').map((tag) => [tag.name, tag.attrs.href]);
      assert.deepEqual(current, [['a', path]], path);
    }
  });
});

test('the mobile nav strip marks the current page with aria-current, like the sidebar', async () => {
  await withApp(async (app) => {
    const admin = await app.signedIn({ role: 'admin' });
    for (const path of [PATHS.admin.overview, PATHS.admin.settings, PATHS.dashboard]) {
      const { html } = await app.get(admin, path);
      const sidebar = elementByAttr(html, 'data-sidebar');
      assert.ok(sidebar, `${path}: sidebar found`);
      const strips = elementsByAttr(html.replace(sidebar, ''), 'aria-label', 'Main');
      assert.equal(strips.length, 1, `${path}: one mobile nav`);
      assert.equal(attrsOf(strips[0], 'aria-label').tag, 'nav');
      const current = tagsWith(strips[0], 'aria-current', 'page').map((tag) => [tag.name, tag.attrs.href]);
      assert.deepEqual(current, [['a', path]], path);
    }
  });
});
