
export function fakeResponse({ broken = [], html = (view) => `rendered ${view}` } = {}) {
  const out = { view: null, headers: {}, renders: [], errors: [], destroyed: false };
  const res = {
    headersSent: false,
    locals: {},
    req: {
      next(error) {
        out.errors.push(error);
      },
    },
    destroy() {
      out.destroyed = true;
    },
    status(code) {
      out.status = code;
      this.statusCode = code;
      return this;
    },
    render(view, locals, done) {
      out.renders.push([view, locals]);
      if (view.startsWith('layouts/')) {
        out.layout = view;
        out.page = locals.page;
      } else {
        out.view = view;
        out.locals = locals;
      }
      if (done && broken.includes(view)) return done(new Error(`${view} broke`));
      if (done) return done(null, html(view, locals));
      return html(view, locals);
    },
    send(html) {
      out.html = html;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
    set(name, value) {
      out.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      out.headers[name] = value;
      return this;
    },
  };
  return { res, out };
}

export function fakeRequest({ method = 'GET', path = '/', accepts = 'html', headers = {} } = {}) {
  return {
    method,
    path,
    headers,
    get: (name) => headers[name.toLowerCase()],
    accepts: () => accepts,
  };
}
