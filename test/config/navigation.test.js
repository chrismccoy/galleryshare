import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_GROUPS, isNavActive, navFor } from '../../config/navigation.js';

test('the main group lists Dashboard, My activity, Add gallery, My galleries, Trash and Account in order', () => {
  const main = NAV_GROUPS.find((group) => !group.admin);
  assert.deepEqual(
    main.links.map((link) => link.label),
    ['Dashboard', 'My activity', 'Add gallery', 'My galleries', 'Trash', 'Account'],
  );
  assert.deepEqual(
    main.links.slice(2, 4).map((link) => link.icon),
    ['fa-solid fa-images', 'fa-solid fa-table-cells'],
  );
});

test('the admin group lists Overview, Activity, Users, Invites, Galleries, Shared links and Settings', () => {
  const admin = NAV_GROUPS.find((group) => group.admin);
  assert.deepEqual(
    admin.links.map((link) => link.label),
    ['Overview', 'Activity', 'Users', 'Invites', 'Galleries', 'Shared links', 'Settings'],
  );
  assert.equal(admin.links.find((l) => l.key === 'admin-galleries').icon, 'fa-solid fa-photo-film');
  assert.equal(admin.links.find((l) => l.key === 'admin-shares').badgeKey, 'shares');
  assert.deepEqual(
    [NAV_GROUPS[0].links.find((l) => l.label === 'My activity'), admin.links.find((l) => l.label === 'Activity')].map(
      (l) => [l.href, l.icon],
    ),
    [
      ['/dashboard/activity', 'fa-solid fa-clock-rotate-left'],
      ['/admin/activity', 'fa-solid fa-clock-rotate-left'],
    ],
  );
});

test('Trash is in the main navigation with its badge, for users and admins', () => {
  const main = NAV_GROUPS.find((g) => g.key === 'main');
  const trash = main.links.find((l) => l.key === 'trash');
  assert.deepEqual(
    { label: trash.label, href: trash.href, badgeKey: trash.badgeKey },
    { label: 'Trash', href: '/dashboard/trash', badgeKey: 'trash' },
  );
  for (const role of ['user', 'admin']) {
    assert.ok(
      navFor({ role }).some((g) => g.links.some((l) => l.key === 'trash')),
      role,
    );
  }
});

test('My galleries is active on a gallery edit view and its job pages, not on Add gallery', () => {
  const links = NAV_GROUPS.find((g) => g.key === 'main').links;
  const active = (path) => links.filter((link) => isNavActive(link, path)).map((link) => link.key);
  assert.deepEqual(active('/dashboard/galleries'), ['galleries']);
  assert.deepEqual(active('/dashboard/galleries/12'), ['galleries']);
  assert.deepEqual(active('/dashboard/galleries/jobs/3'), ['galleries']);
  assert.deepEqual(active('/dashboard/galleries/new'), ['new-gallery']);
  assert.deepEqual(active('/dashboard/galleries/new/upload'), ['new-gallery']);
  assert.deepEqual(active('/dashboard/trash'), ['trash']);
  assert.deepEqual(active('/dashboard'), ['dashboard']);
});
