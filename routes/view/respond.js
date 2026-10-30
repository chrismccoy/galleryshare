import { NotFoundError, ValidationError } from '../../lib/errors.js';

export function wantsJson(req) {
  return req.accepts(['html', 'json']) === 'json';
}

export function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

export function renderToString(res, view, locals) {
  return new Promise((resolve, reject) => {
    res.render(view, locals, (error, html) => (error ? reject(error) : resolve(html)));
  });
}

function forwardRenderError(res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.req.next(error);
}

async function renderInLayout(res, layout, view, locals, page = {}, layoutLocals = {}) {
  try {
    const viewLocals = { ...locals, pageNotices: pageNoticesOf(locals) };
    const body = await renderToString(res, view, viewLocals);
    const actions = page.actions ? await renderToString(res, page.actions, viewLocals) : '';
    res.send(await renderToString(res, layout, { ...viewLocals, ...layoutLocals, page: { ...page, body, actions } }));
  } catch (error) {
    forwardRenderError(res, error);
  }
}

export const pageNoticesOf = (locals) => ({
  notice: locals.notice ?? null,
  noticeLink: locals.noticeLink ?? null,
  error: locals.error ?? null,
});

export const SHELL_SCRIPTS = Object.freeze(['inline-confirm', 'copy-link', 'dismiss']);

export function renderInShell(res, view, locals, { actions } = {}) {
  const scripts = [...new Set([...SHELL_SCRIPTS, ...(locals.scripts ?? [])])];
  return renderInLayout(res, 'layouts/shell', view, locals, { actions }, { scripts });
}

export function renderPublic(res, view, locals, { wide = false } = {}) {
  return renderInLayout(res, 'layouts/public', view, locals, { wide });
}

export function noStore(res) {
  return res.set('Cache-Control', 'no-store');
}

export function seeOther(res, path) {
  return res.redirect(303, path);
}

export function withNotice(path, key) {
  return `${path}${path.includes('?') ? '&' : '?'}notice=${encodeURIComponent(key)}`;
}

export function notFound(res, { api = false, message = 'Not found.' } = {}) {
  if (api) return jsonError(res, 404, message);
  const render = res.locals.user ? renderInShell : renderPublic;
  return render(res.status(404), 'pages/notfound', { title: 'Not found' });
}

export async function orNotFound(res, handler) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof NotFoundError) return notFound(res);
    throw error;
  }
}


const FORM_ERROR_STATUS = 400;

function formErrorView(error, also) {
  if (error instanceof ValidationError) return { message: error.publicMessage, status: FORM_ERROR_STATUS };
  for (const rule of also) {
    const { type, status = FORM_ERROR_STATUS, message } = typeof rule === 'function' ? { type: rule } : rule;
    if (error instanceof type) return { message: message ?? error.publicMessage, status };
  }
  return null;
}

export async function withFormErrors(res, handler, rerender, { also = [] } = {}) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof NotFoundError) return notFound(res);
    const view = formErrorView(error, also);
    if (view) return rerender(view.message, error, view.status);
    throw error;
  }
}
