import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS_LINE_ROLES, toKpiTiles, toUserKpiTiles } from '../../routes/view/kpi-tiles.js';
import { ROLES } from '../../domain/roles.js';

const emptyOverview = {
  users: 0,
  admins: 0,
  galleries: 0,
  images: 0,
  avgImages: 0,
  bytes: 0,
  liveShares: 0,
  trashed: 0,
  largest: [],
};

test('toKpiTiles: eight tiles with stable data-stat keys, users line and formatted storage', () => {
  const tiles = toKpiTiles({
    userStats: { total: 5, byRole: { admin: 1, user: 4 }, disabled: 2 },
    overview: {
      ...emptyOverview,
      admins: 1,
      galleries: 2,
      images: 5,
      avgImages: 2.5,
      bytes: 1536,
      liveShares: 3,
      trashed: 1,
    },
  });
  assert.deepEqual(
    tiles.map((t) => [t.stat, t.label, t.value]),
    [
      ['users', 'Users', 5],
      ['admins', 'Admins', 1],
      ['galleries', 'Galleries', 2],
      ['images', 'Images', 5],
      ['avg-images', 'Avg images / gallery', 2.5],
      ['storage', 'Storage used', '1.5 KB'],
      ['shares', 'Live share links', 3],
      ['trashed', 'In Trash', 1],
    ],
  );
  assert.equal(tiles[0].help, '1 admin, 4 user, 2 disabled');
});

test('toKpiTiles: a role with no users counts 0', () => {
  const [users] = toKpiTiles({ userStats: { total: 0, byRole: {}, disabled: 0 }, overview: emptyOverview });
  assert.equal(users.help, '0 admin, 0 user, 0 disabled');
});

test('toUserKpiTiles: the dashboard tiles in order, with formatted storage and the tones kpi-card knows', () => {
  const tiles = toUserKpiTiles({ galleries: 3, images: 40, bytes: 1024 * 1024, liveLinks: 1 });
  assert.deepEqual(
    tiles.map((tile) => [tile.stat, tile.value, tile.tone]),
    [
      ['galleries', 3, 'brand'],
      ['images', 40, 'green'],
      ['storage', '1.0 MB', 'amber'],
      ['shares', 1, 'sky'],
    ],
  );
});

test('USERS_LINE_ROLES names every role exactly once', () => {
  assert.deepEqual([...USERS_LINE_ROLES].sort(), [...ROLES].sort());
});
