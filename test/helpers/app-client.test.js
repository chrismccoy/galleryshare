import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from './app-client.js';
import { TEST_PASSWORD } from './constants.js';
import { PATHS } from '../../config/urls.js';

test('every client helper but the raw request gives the response and its body text', async () => {
  await withApp(async (app) => {
    const raw = await app.request(PATHS.login);
    assert.equal(typeof raw.text, 'function', 'request gives the bare Response');
    await raw.arrayBuffer();

    const visitor = await app.anonymous();
    assert.equal(visitor.res.status, 200);
    assert.match(visitor.html, /<form/);

    const refused = await app.postAnonymous(PATHS.login, { email: 'nobody@example.com', password: TEST_PASSWORD });
    assert.equal(refused.res.status, 400);
    assert.match(refused.html, /Incorrect email or password\./);

    const session = await app.signedIn();
    assert.equal(session.res.status, 303);
    assert.equal(typeof session.html, 'string');
    for (const result of [await app.get(session, PATHS.account), await app.post(session, PATHS.logout)]) {
      assert.deepEqual(Object.keys(result).sort(), ['html', 'res']);
    }
  });
});

test('a signed-in session carries get and post bound to its own cookie and token', async () => {
  await withApp(async (app) => {
    const first = await app.signedIn();
    const second = await app.signedIn();
    const mine = await first.get(PATHS.account);
    assert.equal(mine.res.status, 200);
    assert.ok(mine.html.includes(first.user.email), 'the page is the first user’s');
    assert.ok(!mine.html.includes(second.user.email));
    const other = await second.get(PATHS.account);
    assert.ok(other.html.includes(second.user.email), 'each session reads its own account');
    const loggedOut = await first.post(PATHS.logout);
    assert.equal(loggedOut.res.status, 303, 'post sends the session token');
    assert.equal((await first.get(PATHS.account)).res.status, 303, 'the session is gone after logout');
    const badToken = await second.post(PATHS.logout, {}, { csrf: 'wrong' });
    assert.equal(badToken.res.status, 403, 'options reach the app: a wrong token is refused');
  });
});

test('withApp takes (fn), (env, fn) or (env, options, fn) and closes the app every time', async () => {
  let seen = await withApp(async (app) => app.context.config.rateLimit.shareMax);
  assert.equal(typeof seen, 'number');
  seen = await withApp({ RATE_LIMIT_SHARE_MAX: '3' }, async (app) => app.context.config.rateLimit.shareMax);
  assert.equal(seen, 3);
  seen = await withApp({ RATE_LIMIT_SHARE_MAX: '4' }, { media: 'gs-withapp-' }, async (app) => [
    app.context.config.rateLimit.shareMax,
    app.root !== null,
  ]);
  assert.deepEqual(seen, [4, true], 'options reach startApp (a media folder of its own)');
});
