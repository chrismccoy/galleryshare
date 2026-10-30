import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/app-client.js';
import { activityRows } from '../helpers/activity.js';
import { decodeEntities } from '../helpers/html.js';
import { PATH_TO } from '../../config/urls.js';

const LIMITED = { RATE_LIMIT_PUBLIC_FORM_MAX: '2' };

test('a refused reset (password too short) shows the form again with the reason; the link still works', async () => {
  await withApp(async (app) => {
    const admin = await app.createUser({ role: 'admin' });
    const user = await app.createUser({ email: 'short@example.com' });
    const { token } = app.context.resetService.issue(user.id, admin.id);
    const refused = await app.postAnonymous(PATH_TO.reset(token), { password: 'short' });
    assert.equal(refused.res.status, 400);
    assert.match(decodeEntities(refused.html), /Password must be at least 10 characters\./);
    assert.equal(app.context.resetService.problemForToken(token), null, 'the link is not used up');
    const done = await app.postAnonymous(PATH_TO.reset(token), { password: 'long enough now' });
    assert.equal(done.res.status, 303);
  });
});

for (const { form, path, field } of [
  {
    form: 'invite form',
    path: (app, admin) =>
      PATH_TO.invite(app.context.invitesService.create({ role: 'user', createdBy: admin.id }).token),
    field: { email: 'flood@example.com', displayName: 'Flood', password: 'short' },
  },
  {
    form: 'reset form',
    path: (app, admin, user) => PATH_TO.reset(app.context.resetService.issue(user.id, admin.id).token),
    field: { password: 'short' },
  },
]) {
  test(`the ${form} is rate-limited per IP: past the limit it answers 429 and records rateLimitHit "${form}"`, async () => {
    await withApp(LIMITED, async (app) => {
      const admin = await app.createUser({ role: 'admin' });
      const user = await app.createUser();
      const url = path(app, admin, user);
      const { cookie, csrf } = await app.anonymous(url);
      for (let i = 0; i < 2; i++) {
        const res = await app.request(url, { form: field, cookie, csrf });
        assert.equal(res.status, 400, `attempt ${i + 1} is refused for its content, not counted out`);
      }
      const res = await app.request(url, { form: field, cookie, csrf });
      assert.equal(res.status, 429);
      assert.match(await res.text(), /Too many attempts\. Try again in a few minutes\./);
      const [hit] = activityRows(app.context, 'rateLimitHit').filter((row) => row.details === form);
      assert.ok(hit, `a rateLimitHit named "${form}"`);
      assert.equal(hit.actor_type, 'visitor');
    });
  });
}
