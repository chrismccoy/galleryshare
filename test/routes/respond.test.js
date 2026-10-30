import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jsonError,
  noStore,
  notFound,
  orNotFound,
  pageNoticesOf,
  renderInShell,
  SHELL_SCRIPTS,
  renderPublic,
  renderToString,
  withFormErrors,
  withNotice,
} from '../../routes/view/respond.js';
import { InvalidCredentialsError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { fakeResponse } from '../helpers/fake-response.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { listen } from '../helpers/app-client.js';
import { tempDir } from '../helpers/temp.js';

function viewRecorder() {
  const { res, out } = fakeResponse();
  return {
    res,
    rendered: () => out.view,
  };
}

test('withFormErrors: returns a promise of the handler result when nothing is thrown, for a sync handler too', async () => {
  const { res } = viewRecorder();
  const result = withFormErrors(
    res,
    () => 'ok',
    () => 'rerendered',
  );
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'ok');
});

test('withFormErrors: a ValidationError re-renders with its public message; NotFoundError is a 404', async () => {
  const { res, rendered } = viewRecorder();
  assert.equal(
    await withFormErrors(
      res,
      () => {
        throw new ValidationError('Bad value.');
      },
      (message) => `form:${message}`,
    ),
    'form:Bad value.',
  );
  await withFormErrors(
    res,
    () => {
      throw new NotFoundError('gone');
    },
    () => 'no',
  );
  assert.equal(rendered(), 'pages/notfound');
});

test('orNotFound passes the result through, answers 404 for NotFoundError and rethrows the rest', async () => {
  const { res, rendered } = viewRecorder();
  const result = orNotFound(res, () => 'ok');
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'ok');
  assert.equal(rendered(), null);
  await orNotFound(res, () => {
    throw new NotFoundError('gone');
  });
  assert.equal(rendered(), 'pages/notfound');
  await assert.rejects(
    orNotFound(res, () => {
      throw new ValidationError('not a 404');
    }),
    ValidationError,
  );
  await assert.rejects(
    orNotFound(res, async () => {
      throw new TypeError('bug');
    }),
    TypeError,
  );
});

test('withFormErrors: other errors propagate as a rejection, from sync and async handlers', async () => {
  const { res } = viewRecorder();
  await assert.rejects(
    withFormErrors(
      res,
      () => {
        throw new TypeError('bug');
      },
      () => 'no',
    ),
    TypeError,
  );
  await assert.rejects(
    withFormErrors(
      res,
      async () => {
        throw new TypeError('bug');
      },
      () => 'no',
    ),
    TypeError,
  );
  assert.equal(
    await withFormErrors(
      res,
      async () => {
        throw new ValidationError('Async bad.');
      },
      (m) => m,
    ),
    'Async bad.',
  );
});

test('withFormErrors: errors listed in `also` re-render with their public message and the error itself', async () => {
  const { res } = viewRecorder();
  const thrown = new InvalidCredentialsError('wrong password for user 1');
  const seen = await withFormErrors(
    res,
    async () => {
      throw thrown;
    },
    (message, error) => ({ message, error }),
    { also: [InvalidCredentialsError] },
  );
  assert.deepEqual(seen, { message: 'Incorrect email or password.', error: thrown });
  await assert.rejects(
    withFormErrors(
      res,
      async () => {
        throw new InvalidCredentialsError('not listed');
      },
      () => 'no',
    ),
    InvalidCredentialsError,
  );
});

test('withFormErrors: an `also` rule can set the status and the message shown; a ValidationError re-renders with 400', async () => {
  const { res } = viewRecorder();
  const rerender = (message, _error, status) => ({ message, status });
  const rules = { also: [{ type: InvalidCredentialsError, message: 'Wrong current password.', status: 401 }] };
  assert.deepEqual(
    await withFormErrors(
      res,
      () => {
        throw new InvalidCredentialsError('wrong');
      },
      rerender,
      rules,
    ),
    { message: 'Wrong current password.', status: 401 },
  );
  assert.deepEqual(
    await withFormErrors(
      res,
      () => {
        throw new ValidationError('Bad.');
      },
      rerender,
      rules,
    ),
    { message: 'Bad.', status: 400 },
  );
  const statusOnly = { also: [{ type: InvalidCredentialsError, status: 403 }] };
  assert.deepEqual(
    await withFormErrors(
      res,
      () => {
        throw new InvalidCredentialsError('wrong');
      },
      rerender,
      statusOnly,
    ),
    { message: 'Incorrect email or password.', status: 403 },
  );
});

test('noStore sets Cache-Control: no-store and returns the response', () => {
  const { res, out } = fakeResponse();
  assert.equal(noStore(res), res);
  assert.deepEqual(out.headers, { 'Cache-Control': 'no-store' });
});

test('jsonError sends { error } with the status', () => {
  const { res, out } = fakeResponse();
  assert.equal(jsonError(res, 418, 'Short and stout.'), res);
  assert.equal(out.status, 418);
  assert.deepEqual(out.body, { error: 'Short and stout.' });
});

test('renderToString resolves with the HTML and rejects with the render error', async () => {
  const { res } = fakeResponse({
    broken: ['bad'],
    html: (view, locals) => `<p>${view}:${locals.name}</p>`,
  });
  assert.equal(await renderToString(res, 'partials/x', { name: 'a' }), '<p>partials/x:a</p>');
  await assert.rejects(renderToString(res, 'bad', {}), { message: 'bad broke' });
});

function layoutRes(broken = []) {
  const { res, out } = fakeResponse({
    broken,
    html: (view) => `<${view}>`,
  });
  return { res, renders: out.renders, out };
}

test('every page gets pageNotices: its notice, notice link and error, null when unset', async () => {
  const { res, renders } = layoutRes();
  await renderInShell(res, 'pages/x', { notice: 'Saved.', error: 'Bad.', noticeLink: { href: '/a', label: 'A' } });
  assert.deepEqual(renders[0][1].pageNotices, {
    notice: 'Saved.',
    noticeLink: { href: '/a', label: 'A' },
    error: 'Bad.',
  });
  assert.deepEqual(pageNoticesOf({}), { notice: null, noticeLink: null, error: null });
});

test('renderInShell renders the page view and its heading actions, then sends the shell around them', async () => {
  const { res, renders, out } = layoutRes();
  const sent = renderInShell(res, 'pages/x', { title: 'X' }, { actions: 'partials/head-actions/x' });
  assert.ok(sent instanceof Promise, 'callers can return or await the render');
  assert.equal(await sent, undefined);
  assert.deepEqual(
    renders.map(([view]) => view),
    ['pages/x', 'partials/head-actions/x', 'layouts/shell'],
  );
  const noNotices = { notice: null, noticeLink: null, error: null };
  assert.deepEqual(renders[0][1], { title: 'X', pageNotices: noNotices }, 'the page view gets the page locals');
  assert.deepEqual(renders[1][1], { title: 'X', pageNotices: noNotices }, 'the actions get the page locals');
  assert.equal(renders[2][1].title, 'X', 'the layout gets the page locals');
  assert.deepEqual(renders[2][1].scripts, SHELL_SCRIPTS, 'the layout loads the shell scripts');
  assert.deepEqual(renders[2][1].page, { body: '<pages/x>', actions: '<partials/head-actions/x>' });
  assert.equal(out.html, '<layouts/shell>', 'the layout HTML is sent');

  const plain = layoutRes();
  await renderInShell(plain.res, 'pages/y', { title: 'Y' });
  assert.deepEqual(
    plain.renders.map(([view]) => view),
    ['pages/y', 'layouts/shell'],
  );
  assert.deepEqual(plain.renders[1][1].page, { body: '<pages/y>', actions: '' });

  const withScripts = layoutRes();
  await renderInShell(withScripts.res, 'pages/z', { title: 'Z', scripts: ['reorder', 'copy-link'] });
  assert.deepEqual(
    withScripts.renders[1][1].scripts,
    [...SHELL_SCRIPTS, 'reorder'],
    'page scripts follow the shell scripts, each once',
  );
});

test('renderPublic wraps the page view in the public layout, centred unless wide; there is no other variant', async () => {
  const centred = layoutRes();
  await renderPublic(centred.res, 'pages/login', { title: 'Sign in' });
  assert.deepEqual(centred.renders[1][0], 'layouts/public');
  assert.deepEqual(centred.renders[1][1].page, { wide: false, body: '<pages/login>', actions: '' });
  const wide = layoutRes();
  await renderPublic(wide.res, 'pages/share', { title: 'Shared' }, { wide: true });
  assert.deepEqual(wide.renders[1][1].page, { wide: true, body: '<pages/share>', actions: '' });
  const unknown = layoutRes();
  await renderPublic(unknown.res, 'pages/x', { title: 'X' }, { front: true });
  assert.equal('front' in unknown.renders[1][1].page, false, 'the old front option is gone');
});

test('a page view, heading actions or layout that fail to render go to the error handler; the promise resolves', async () => {
  for (const broken of ['pages/x', 'partials/head-actions/x', 'layouts/shell']) {
    const { res, renders, out } = layoutRes([broken]);
    assert.equal(await renderInShell(res, 'pages/x', {}, { actions: 'partials/head-actions/x' }), undefined, broken);
    assert.equal(out.errors.length, 1, broken);
    assert.match(out.errors[0].message, /broke/, broken);
    assert.equal(out.html, undefined, broken);
    if (broken !== 'layouts/shell') assert.ok(!renders.some(([view]) => view.startsWith('layouts/')), broken);
  }
  const publicPage = layoutRes(['pages/login']);
  await renderPublic(publicPage.res, 'pages/login', {});
  assert.equal(publicPage.out.errors.length, 1);
});

test('a render error after the headers went out ends the response instead of calling the error handler', async () => {
  const { res, out } = layoutRes(['pages/x']);
  res.headersSent = true;
  await renderInShell(res, 'pages/x', {});
  assert.equal(out.destroyed, true);
  assert.deepEqual(out.errors, []);
});

test('notFound: the 404 page in the shell when signed in, else in the public layout', async () => {
  const signedIn = layoutRes();
  signedIn.res.locals.user = { id: 1 };
  await notFound(signedIn.res);
  assert.equal(signedIn.res.statusCode, 404);
  assert.deepEqual(
    signedIn.renders.map(([view]) => view),
    ['pages/notfound', 'layouts/shell'],
  );
  const anonymous = layoutRes();
  await notFound(anonymous.res);
  assert.equal(anonymous.res.statusCode, 404);
  assert.deepEqual(
    anonymous.renders.map(([view]) => view),
    ['pages/notfound', 'layouts/public'],
  );
});

test('withNotice adds the notice key as `?notice=`, encoded, and keeps an existing query', () => {
  assert.equal(withNotice('/dashboard/trash', 'restored'), '/dashboard/trash?notice=restored');
  assert.equal(withNotice('/admin/users/7', 'a b&c'), '/admin/users/7?notice=a%20b%26c');
  assert.equal(withNotice('/dashboard/galleries?before=9', 'trashed'), '/dashboard/galleries?before=9&notice=trashed');
});

async function forgetfulApp(t) {
  const views = tempDir(t, 'gs-respond-');
  const files = {
    'pages/ok.ejs': '<p>ok</p>',
    'pages/bad.ejs': "<% throw new Error('view broke'); %>",
    'pages/notfound.ejs': "<% throw new Error('404 view broke'); %>",
    'layouts/shell.ejs': '<main><%- page.body %></main>',
    'layouts/public.ejs': '<main><%- page.body %></main>',
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(views, name)), { recursive: true });
    fs.writeFileSync(path.join(views, name), text);
  }
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', views);
  app.get('/ok', (_req, res) => {
    renderInShell(res, 'pages/ok', {});
  });
  app.get('/bad', (_req, res) => {
    renderInShell(res, 'pages/bad', {});
  });
  app.get('/bad-public', (_req, res) => {
    renderPublic(res, 'pages/bad', {});
  });
  app.get('/missing', (_req, res) => {
    notFound(res);
  });
  app.use((error, _req, res, _next) => res.status(500).send(`error page: ${error.message}`));
  const { url, close } = await listen(app);
  t.after(close);
  return url;
}

test('a render error in a handler that does not return the render still reaches the error handler', async (t) => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));
  const url = await forgetfulApp(t);
  const ok = await fetch(`${url}/ok`, { signal: AbortSignal.timeout(3000) });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '<main><p>ok</p></main>');
  for (const [route, message] of [
    ['/bad', 'view broke'],
    ['/bad-public', 'view broke'],
    ['/missing', '404 view broke'],
  ]) {
    const res = await fetch(`${url}${route}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 500, route);
    const text = await res.text();
    assert.ok(text.startsWith('error page: ') && text.endsWith(message), `${route}: ${text}`);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rejections, [], 'no render promise rejected unhandled');
});
