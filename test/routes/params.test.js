import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useIdParam } from '../../routes/middleware/params.js';
import { fakeResponse } from '../helpers/fake-response.js';

test('useIdParam: a positive whole :id is parsed onto req.idParam; anything else is the standard 404', () => {
  const handlers = {};
  useIdParam({
    param: (name, handler) => (handlers[name] = handler),
  });
  const run = (value) => {
    const { res, out } = fakeResponse();
    const req = {};
    let nextCalled = false;
    handlers.id(req, res, () => (nextCalled = true), value);
    return { req, out, nextCalled };
  };
  const ok = run('12');
  assert.equal(ok.nextCalled, true);
  assert.equal(ok.req.idParam, 12);
  assert.equal(ok.out.view, null);
  for (const bad of ['0', '-3', 'abc', '1.5', '012']) {
    const refused = run(bad);
    assert.equal(refused.nextCalled, false, bad);
    assert.equal(refused.out.status, 404, bad);
    assert.equal(refused.out.view, 'pages/notfound', bad);
  }
});

test('useIdParam can validate another parameter onto another request key', () => {
  const handlers = {};
  useIdParam(
    {
      param: (name, handler) => (handlers[name] = handler),
    },
    'imageId',
    'imageIdParam',
  );
  const req = {};
  const { res, out } = fakeResponse();
  let nextCalled = false;
  handlers.imageId(req, res, () => (nextCalled = true), '7');
  assert.deepEqual([nextCalled, req.imageIdParam, req.idParam], [true, 7, undefined]);
  handlers.imageId({}, res, () => assert.fail('next must not run'), 'x');
  assert.equal(out.status, 404);
});
