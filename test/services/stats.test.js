import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatsService } from '../../services/stats.service.js';
import { buildContext, insertUser } from '../helpers/context.js';
import { seedGallery } from '../helpers/gallery-seed.js';

async function seeded() {
  const { context } = buildContext();
  const u1 = await insertUser(context, { displayName: 'One' });
  const u2 = await insertUser(context, { role: 'admin', displayName: 'Two' });
  const g1 = seedGallery(context, u1.id, { title: 'Small', images: 1, bytes: 500 });
  seedGallery(context, u1.id, { title: 'Medium', images: 2, bytes: 1000 });
  const g3 = seedGallery(context, u2.id, { title: 'Large', images: 3, bytes: 2000 });
  context.galleries.trashById(g1);
  context.sharesService.share(u2, g3);
  return { context };
}

test('stats service: seeded set gives galleries 2, images 5, avg 2.5, trashed 1, bytes of live images', async () => {
  const { context } = await seeded();
  const stats = createStatsService({ users: context.users, galleries: context.galleries, shares: context.shares });
  const o = stats.overview();
  assert.equal(o.users, 2);
  assert.equal(o.admins, 1);
  assert.equal(o.galleries, 2);
  assert.equal(o.images, 5);
  assert.equal(o.avgImages, 2.5);
  assert.equal(o.bytes, 2 * 1000 + 3 * 2000);
  assert.equal(o.liveShares, 1);
  assert.equal(o.trashed, 1);
  assert.deepEqual(
    o.largest.map((g) => g.title),
    ['Large', 'Medium'],
  );
  assert.equal(o.largest[0].owner_name, 'Two');
});

test('stats service: no galleries gives avgImages 0', () => {
  const { context } = buildContext();
  const stats = createStatsService({ users: context.users, galleries: context.galleries, shares: context.shares });
  const o = stats.overview();
  assert.equal(o.avgImages, 0);
  assert.equal(o.galleries, 0);
  assert.deepEqual(o.largest, []);
});
