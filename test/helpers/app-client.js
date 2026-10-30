import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server.js';
import { syncEnvAdmin } from '../../app/env-admin-sync.js';
import { buildContext, insertUser } from './context.js';
import { TEST_PASSWORD } from './constants.js';
import { cookiesFrom } from './cookies.js';
import { csrfFromHtml } from './html.js';
import { PATHS } from '../../config/urls.js';

export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createRequester(url) {
  function request(path, { method, form, body, cookie, csrf, headers = {} } = {}) {
    const init = { method: method ?? (form ? 'POST' : 'GET'), redirect: 'manual', headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (body !== undefined) {
      if (form || csrf)
        throw new Error('request(): pass the CSRF token inside `body` or a header, not with `form`/`csrf`');
      init.body = body;
      init.method = method ?? 'POST';
    } else if (form || csrf) {
      const body = new URLSearchParams(form ?? {});
      if (csrf) body.set('_csrf', csrf);
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = body.toString();
      init.method = method ?? 'POST';
    }
    return fetch(`${url}${path}`, init);
  }

  async function status(path, options) {
    const res = await request(path, options);
    await res.arrayBuffer();
    return res.status;
  }

  return { request, status };
}

function createSessions({ request, context }) {
  async function anonymous(path = PATHS.login) {
    const res = await request(path);
    const html = await res.text();
    const pre = cookiesFrom(res).pre;
    return { cookie: pre ? `pre=${pre}` : undefined, csrf: csrfFromHtml(html), html, res };
  }

  async function postAnonymous(path, form, { pagePath = path } = {}) {
    const { cookie, csrf } = await anonymous(pagePath);
    const res = await request(path, { form, cookie, csrf });
    return { res, html: await res.text() };
  }

  async function get(session, path) {
    const res = await request(path, { cookie: session.cookie });
    return { res, html: await res.text() };
  }

  async function post(session, path, form = {}, { csrf = session.csrf } = {}) {
    const res = await request(path, { form, cookie: session.cookie, csrf });
    return { res, html: await res.text() };
  }

  async function login(email, password = TEST_PASSWORD) {
    const { res, html } = await postAnonymous(PATHS.login, { email, password });
    const sid = cookiesFrom(res).sid;
    if (res.status !== 303 || !sid) throw new Error(`sign-in failed for ${email} (status ${res.status})`);
    const session = { cookie: `sid=${sid}`, csrf: context.sessions.liveByToken(sid).csrf_token, res, html };
    return {
      ...session,
      get: (path) => get(session, path),
      post: (path, form, options) => post(session, path, form, options),
    };
  }

  async function signedIn(options) {
    const user = await insertUser(context, options);
    return { user, ...(await login(user.email)) };
  }

  return { anonymous, postAnonymous, login, signedIn, get, post };
}


export async function startApp(overrides = {}, { media } = {}) {
  const root = media ? fs.mkdtempSync(path.join(os.tmpdir(), media)) : null;
  const env = root
    ? { MEDIA_DIR: path.join(root, 'media'), TMP_UPLOAD_DIR: path.join(root, 'tmp'), ...overrides }
    : overrides;
  const { context } = buildContext({ env });
  await syncEnvAdmin(context);
  const app = createApp(context.app);
  const { url, close: stop } = await listen(app);
  const requester = createRequester(url);

  return {
    url,
    root,
    context,
    express: app,
    ...requester,
    ...createSessions({ request: requester.request, context }),
    createUser: (options) => insertUser(context, options),
    close: async () => {
      await stop();
      context.db.close();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function withApp(envOrFn, optionsOrFn, fn) {
  const args = [envOrFn, optionsOrFn, fn].filter((arg) => arg !== undefined);
  const run = args.pop();
  const [env = {}, options = {}] = args;
  const app = await startApp(env, options);
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}
