import { test } from 'node:test';
import express from 'express';
import assert from 'node:assert/strict';
import { errorHandler } from '../../routes/middleware/errors.js';
import { GENERIC_ERROR_MESSAGE, NotFoundError } from '../../lib/errors.js';
import { fakeRequest, fakeResponse } from '../helpers/fake-response.js';
import { silentLogger } from '../helpers/constants.js';
import { listen } from '../helpers/app-client.js';

function handleError(error) {
  const { res, out } = fakeResponse();
  const req = fakeRequest({ path: '/admin/galleries' });
  errorHandler(silentLogger)(error, req, res, () => {});
  return out;
}

test('an unexpected error on a page says "Something went wrong"', () => {
  const out = handleError(new ReferenceError('notice is not defined'));
  assert.equal(out.status, 500);
  assert.equal(out.view, 'pages/error');
  assert.equal(out.locals.message, GENERIC_ERROR_MESSAGE);
});

test('AppError copy is still shown as is', () => {
  const error = new NotFoundError('x');
  const out = handleError(error);
  assert.equal(out.status, error.publicStatus);
  assert.equal(out.locals.message, error.publicMessage);
});

async function failingRequests(routes, urls) {
  const logged = [];
  const app = express();
  for (const route of routes) {
    app.get(route, () => {
      throw new Error('boom');
    });
  }
  app.use(
    errorHandler({
      ...silentLogger,
      error: (message, fields) => logged.push({ message, fields }),
    }),
  );
  const server = await listen(app);
  try {
    for (const url of urls) await fetch(`${server.url}${url}`);
  } finally {
    await server.close();
  }
  return logged;
}

test('a 5xx on a share, invite or reset URL logs the route pattern, never the token', async () => {
  const secret = 'SeCrEt-tOkEn_123';
  const routes = ['/s/:token', '/s/:token/zip', '/s/:token/i/:name/:size', '/invite/:token', '/reset/:token'];
  const urls = routes.map((r) => r.replace(':token', secret).replace(':name', 'n').replace(':size', 'web'));
  const logged = await failingRequests(routes, urls);
  assert.deepEqual(
    logged.map((l) => l.fields.path),
    routes,
  );
  assert.ok(!JSON.stringify(logged).includes(secret));
});

test('a 5xx without a matched route masks the token segment of a secret-bearing path', () => {
  const logged = [];
  const { res } = fakeResponse();
  const req = fakeRequest({ path: '/s/SeCrEt/zip' });
  const logger = {
    ...silentLogger,
    error: (_message, fields) => logged.push(fields),
  };
  errorHandler(logger)(new Error('x'), req, res, () => {});
  assert.equal(logged[0].path, '/s/:token/zip');
  assert.ok(!JSON.stringify(logged).includes('SeCrEt'));
  for (const path of ['/S/SeCrEt/zip', '/Invite/SeCrEt', '/RESET/SeCrEt']) {
    errorHandler(logger)(new Error('x'), fakeRequest({ path }), fakeResponse().res, () => {});
    assert.match(logged.at(-1).path, /^\/[a-z]+\/:token/i, path);
    assert.ok(!logged.at(-1).path.includes('SeCrEt'), `upper-case ${path} is masked`);
  }
});
