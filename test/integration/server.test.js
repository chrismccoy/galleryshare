import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, shutdown, startServer } from '../../server.js';
import { createPreTokens } from '../../routes/middleware/csrf.js';
import { MS_PER_HOUR } from '../../lib/time.js';
import { createAppContext } from '../../app/context.js';
import { createSessionsRepository } from '../../db/sessions.repository.js';
import { createActivityRepository } from '../../db/activity.repository.js';
import { openDatabase } from '../../db/database.js';
import { migrate } from '../../db/migrations.js';
import { testConfig } from '../helpers/context.js';
import { freshDb, rowCount } from '../helpers/db.js';
import { earlier, fakeClock, later, mockIntervals } from '../helpers/clock.js';
import { tempDir } from '../helpers/temp.js';
import { listen } from '../helpers/app-client.js';
import { silentLogger } from '../helpers/constants.js';
import { ENV_ADMIN, insertBareUser, openSession } from '../helpers/accounts.js';
import { recordingLogger } from '../helpers/logger.js';

async function withServer(t, { env = {}, seed, ...start }, fn) {
  const dir = tempDir(t, 'galleryshare-serve-');
  const file = path.join(dir, 'app.sqlite');
  if (seed) {
    const db = openDatabase(file);
    try {
      migrate(db);
      seed(db);
    } finally {
      db.close();
    }
  }
  const config = testConfig({ DATABASE_PATH: file, ...env });
  const { server, context, close } = await startServer({ config, logger: silentLogger, port: 0, ...start });
  try {
    await fn({ server, context, close, dir, file });
  } finally {
    await close();
  }
}

async function withListening(context, fn) {
  const { server, close } = await listen(createApp(context));
  try {
    await fn(server);
  } finally {
    await close();
    context.db.close();
  }
}

test('startServer migrates, sweeps expired sessions before listening, and serves', async (t) => {
  let liveToken;
  await withServer(
    t,
    {
      env: { PORT: '1', HOST: '127.0.0.1' },
      seed: (db) => {
        const userId = insertBareUser(db, { email: 'a@example.com', role: 'admin' });
        const sessions = createSessionsRepository(db);
        openSession(sessions, { userId, expiresAt: earlier() });
        liveToken = openSession(sessions, { userId, expiresAt: later() }).token;
      },
    },
    async ({ server, context }) => {
      assert.equal(rowCount(context.db, 'sessions'), 1);
      assert.ok(context.sessions.liveByToken(liveToken));
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/login`);
      assert.equal(res.status, 200);
    },
  );
});

function openHandlesOn(file) {
  return fs.readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return fs.readlinkSync(`/proc/self/fd/${fd}`) === file;
    } catch {
      return false;
    }
  }).length;
}

test(
  'startServer rejects when the port is taken and closes the database it opened',
  { skip: process.platform !== 'linux' && 'needs /proc/self/fd' },
  async (t) => {
    await withServer(t, {}, async ({ server, dir }) => {
      const file = path.join(dir, 'b.sqlite');
      const { port } = server.address();
      await assert.rejects(
        startServer({ config: testConfig({ DATABASE_PATH: file }), logger: silentLogger, port }),
        /EADDRINUSE/,
      );
      assert.equal(openHandlesOn(file), 0);
    });
  },
);

const openDbHandles = (file) => ['', '-wal', '-shm'].reduce((n, suffix) => n + openHandlesOn(file + suffix), 0);

test(
  'close() stops the timer and the server, waits for ingest to finish, then releases the database files',
  { skip: process.platform !== 'linux' && 'needs /proc/self/fd' },
  async (t) => {
    mockIntervals(t);
    await withServer(t, { housekeepingIntervalMs: 1000 }, async ({ server, context, close, file }) => {
      assert.ok(openDbHandles(file) > 0, 'the database is open while serving');
      let finishIngest;
      const ingestDone = new Promise((resolve) => (finishIngest = resolve));
      t.mock.method(context.ingestService, 'idle', () => ingestDone);
      const clear = t.mock.method(globalThis, 'clearInterval');
      const closing = close();
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(clear.mock.callCount() >= 1, 'the housekeeping interval is cleared');
        assert.equal(server.listening, false, 'the server stops accepting connections');
        assert.equal(context.db.open, true, 'the database stays open while ingest runs');
      } finally {
        finishIngest();
      }
      await closing;
      assert.equal(context.db.open, false);
      assert.equal(openDbHandles(file), 0, 'no file handle on the database is left');
      await close();
    });
  },
);

test('startServer records serverStarted with the address and close() records serverStopped before the database closes', async (t) => {
  await withServer(t, { host: '127.0.0.1' }, async ({ server, context, close }) => {
    const kinds = () =>
      createActivityRepository(context.db)
        .list({ area: 'system', limit: 10 })
        .reverse()
        .map(({ kind, actor_type, details }) => ({ kind, actor_type, details }));
    assert.deepEqual(kinds(), [
      { kind: 'serverStarted', actor_type: 'system', details: `http://127.0.0.1:${server.address().port}` },
    ]);
    await close();
  });
  const dir = tempDir(t, 'galleryshare-stop-');
  const file = path.join(dir, 'app.sqlite');
  const started = await startServer({
    config: testConfig({ DATABASE_PATH: file }),
    logger: silentLogger,
    port: 0,
    host: '127.0.0.1',
  });
  await started.close();
  const db = openDatabase(file);
  try {
    assert.deepEqual(
      createActivityRepository(db)
        .list({ area: 'system', limit: 10 })
        .map((row) => row.kind)
        .reverse(),
      ['serverStarted', 'serverStopped'],
    );
  } finally {
    db.close();
  }
});

test('close() still releases the database after the server was closed on its own', async (t) => {
  await withServer(t, {}, async ({ server, context, close }) => {
    await new Promise((resolve) => server.close(resolve));
    await close();
    assert.equal(context.db.open, false);
  });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('close() waits for a housekeeping run in progress before closing the database', async (t) => {
  mockIntervals(t);
  await withServer(t, { housekeepingIntervalMs: 1000 }, async ({ context, close }) => {
    let finishPurge;
    t.mock.method(
      context.galleriesService,
      'purgeTrashedBefore',
      () => new Promise((resolve) => (finishPurge = () => resolve(0))),
    );
    mock.timers.tick(1000);
    assert.equal(typeof finishPurge, 'function', 'the housekeeping run started');
    const closing = close();
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(context.db.open, true, 'the database stays open while housekeeping runs');
    } finally {
      finishPurge();
    }
    await closing;
    assert.equal(context.db.open, false);
  });
});

const SERVER_FILE = fileURLToPath(new URL('../../server.js', import.meta.url));

const UNINHERITED = [
  'PUBLIC_URL',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_NAME',
  'DATABASE_PATH',
  'MEDIA_DIR',
  'TMP_UPLOAD_DIR',
  'LOG_LEVEL',
];

function childEnv(t, overrides) {
  const env = { ...process.env };
  for (const name of UNINHERITED) delete env[name];
  return {
    ...env,
    GALLERYSHARE_SKIP_ENV_FILE: '1',
    NODE_ENV: 'test',
    LOG_DIR: path.join(tempDir(t, 'galleryshare-log-'), 'logs'),
    ...overrides,
  };
}

function shutdownHarness(starting) {
  const logs = [];
  let exitWith;
  const exited = new Promise((resolve) => (exitWith = resolve));
  const record = (level) => (message) => logs.push([level, message]);
  const logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    flush: async () => {
      logs.push(['flush', '']);
    },
  };
  const exit = (code) => {
    logs.push(['exit', String(code)]);
    exitWith(code);
  };
  return { options: { starting, logger, exit, timeoutMs: 20 }, exited, logs };
}

const startedWith = (close, closeAllConnections = () => {}) =>
  Promise.resolve({ server: { closeAllConnections }, close });

test('shutdown() exits 0 after a normal close and its deadline never fires', async (t) => {
  const timeout = t.mock.method(globalThis, 'clearTimeout');
  const closeAll = t.mock.fn();
  const h = shutdownHarness(startedWith(async () => {}, closeAll));
  await shutdown('SIGTERM', h.options);
  assert.equal(await h.exited, 0);
  assert.equal(timeout.mock.callCount(), 1, 'the deadline is cleared');
  assert.equal(closeAll.mock.callCount(), 0);
  assert.deepEqual(h.logs, [
    ['info', 'SIGTERM received, shutting down'],
    ['flush', ''],
    ['exit', '0'],
  ]);
});

test('shutdown() gives up after its deadline: it drops open connections, logs and exits 1', async (t) => {
  const closeAll = t.mock.fn();
  const h = shutdownHarness(startedWith(() => new Promise(() => {}), closeAll));
  shutdown('SIGTERM', h.options);
  assert.equal(await h.exited, 1);
  assert.equal(closeAll.mock.callCount(), 1);
  assert.ok(h.logs.some(([level, message]) => level === 'error' && /shutdown timed out/.test(message)));
  assert.deepEqual(
    h.logs.slice(-2),
    [
      ['flush', ''],
      ['exit', '1'],
    ],
    'the log file is written out after the timeout line and before the exit',
  );
});

test('shutdown() that times out exits 1 only, even when dropping the connections lets the close finish', async () => {
  let closed;
  const close = () => new Promise((resolve) => (closed = resolve));
  const h = shutdownHarness(startedWith(close, () => closed()));
  await shutdown('SIGTERM', h.options);
  assert.equal(await h.exited, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    h.logs.filter(([level]) => level === 'exit'),
    [['exit', '1']],
    'the process ends once, with the timeout code',
  );
});

test('shutdown() after a failed start exits 1 without logging the startup error again', async () => {
  const starting = Promise.reject(new Error('port taken'));
  starting.catch(() => {});
  const h = shutdownHarness(starting);
  await shutdown('SIGINT', h.options);
  assert.equal(await h.exited, 1);
  assert.deepEqual(h.logs, [
    ['info', 'SIGINT received, shutting down'],
    ['flush', ''],
    ['exit', '1'],
  ]);
});

test('shutdown() logs a failing close once and exits 1', async () => {
  const h = shutdownHarness(
    startedWith(async () => {
      throw new Error('disk gone');
    }),
  );
  await shutdown('SIGTERM', h.options);
  assert.equal(await h.exited, 1);
  assert.deepEqual(h.logs.slice(-3), [
    ['error', 'shutdown failed'],
    ['flush', ''],
    ['exit', '1'],
  ]);
});

test(
  'server.js shuts down cleanly on SIGTERM, writes out the log file and exits 0',
  { skip: process.platform === 'win32' && 'no POSIX signals' },
  async (t) => {
    const dir = tempDir(t, 'galleryshare-sig-');
    const env = childEnv(t, {
      PORT: String(await freePort()),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'test-session-secret',
      DATABASE_PATH: path.join(dir, 'app.sqlite'),
      MEDIA_DIR: path.join(dir, 'media'),
      TMP_UPLOAD_DIR: path.join(dir, 'tmp'),
      LOG_DIR: path.join(dir, 'logs'),
    });
    const child = spawn(process.execPath, [SERVER_FILE], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    let output = '';
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (/listening on/i.test(output)) resolve();
      });
      child.on('exit', () => reject(new Error(`server exited before listening: ${output}`)));
    });
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
    const logDir = path.join(dir, 'logs');
    const logText = fs
      .readdirSync(logDir)
      .filter((name) => name.startsWith('app-'))
      .map((name) => fs.readFileSync(path.join(logDir, name), 'utf8'))
      .join('');
    assert.match(logText, /"message":"Server stopped"/, 'the last line reaches the log file before the exit');
  },
);

test('boot syncs the env admin after migrating, before listening, and logs without the password', async (t) => {
  const { password } = ENV_ADMIN;
  const { logger, info: infos } = recordingLogger();
  await withServer(
    t,
    { env: { ADMIN_EMAIL: 'Owner@Example.com', ADMIN_PASSWORD: password }, logger },
    async ({ context }) => {
      const row = context.users.byEmail(ENV_ADMIN.email);
      assert.equal(row.role, 'admin');
      assert.ok(infos.some(([message]) => /env admin created/.test(message)));
      assert.doesNotMatch(JSON.stringify(infos), new RegExp(password));
    },
  );
});

test('startServer runs housekeeping on its timer and stops the timer when the server closes', async (t) => {
  mockIntervals(t);
  await withServer(t, { housekeepingIntervalMs: 1000 }, async ({ server, context }) => {
    let runs = 0;
    t.mock.method(context.galleriesService, 'purgeTrashedBefore', () => {
      runs += 1;
      return 0;
    });
    const clear = t.mock.method(globalThis, 'clearInterval');
    mock.timers.tick(1000);
    assert.equal(runs, 1, 'the timer fires while the server is up (the purge runs synchronously on the tick)');
    assert.equal(clear.mock.callCount(), 0, 'the timer is still running');
    await new Promise((resolve) => server.close(resolve));
    assert.equal(clear.mock.callCount(), 1, 'closing the server clears the housekeeping interval');
    assert.equal(typeof clear.mock.calls[0].arguments[0]?.hasRef, 'function', 'it clears the interval handle');
  });
});

test('startServer gives its clock to the app context, so repositories stamp the same time as the purges', async (t) => {
  const clock = fakeClock('2026-10-27T00:00:00.000Z');
  await withServer(t, { now: clock.now }, async ({ context }) => {
    const id = context.users.insert({
      email: 'clock@example.com',
      displayName: 'Clock',
      passwordHash: 'x',
      role: 'user',
    });
    assert.equal(context.users.byId(id).created_at, '2026-10-27T00:00:00.000Z');
  });
});

async function preCookieFrom(server) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/login`);
  const match = /(?:^|,\s*)pre=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  assert.ok(match, 'the sign-in page sets the anonymous pre cookie');
  return match[1];
}

test('without SESSION_SECRET the context resolves one random secret, and CSRF signs with it', async (t) => {
  await withServer(t, { env: { SESSION_SECRET: '' } }, async ({ server, context }) => {
    assert.match(context.secret, /^[0-9a-f]{64}$/);
    assert.ok(createPreTokens(context.secret).read(await preCookieFrom(server)));
  });
});

test('without SESSION_SECRET the context warns once that share links reset on restart; with it, no warning', () => {
  const db = freshDb();
  try {
    const unset = recordingLogger();
    createAppContext({ config: testConfig({ SESSION_SECRET: '' }), db, logger: unset.logger });
    assert.equal(unset.warn.length, 1);
    assert.match(unset.warn[0][0], /SESSION_SECRET is not set/);
    assert.match(unset.warn[0][0], /share links/);

    const set = recordingLogger();
    createAppContext({ config: testConfig(), db, logger: set.logger });
    createAppContext({ config: testConfig({ SESSION_SECRET: '' }), db, logger: set.logger, secret: 'given' });
    assert.deepEqual(set.warn, []);
  } finally {
    db.close();
  }
});

test('createApp signs CSRF tokens with context.secret, not SESSION_SECRET', async () => {
  const context = createAppContext({
    config: testConfig(),
    db: freshDb(),
    logger: silentLogger,
    secret: 'context-secret',
  });
  await withListening(context, async (server) => {
    const cookie = await preCookieFrom(server);
    assert.ok(createPreTokens('context-secret').read(cookie));
    assert.equal(createPreTokens('test-session-secret').read(cookie), null);
  });
});

test('the anonymous CSRF cookie follows the context clock', async () => {
  const start = new Date('2030-05-06T07:08:09.000Z');
  const { now } = fakeClock(start);
  const context = createAppContext({ config: testConfig(), db: freshDb(), logger: silentLogger, now });
  await withListening(context, async (server) => {
    const cookie = await preCookieFrom(server);
    assert.equal(cookie.split('.')[1], String(start.getTime() + 2 * MS_PER_HOUR), 'expiry from the injected clock');
    assert.ok(createPreTokens(context.secret, () => start).read(cookie));
    const expiredAt = new Date(start.getTime() + 2 * MS_PER_HOUR + 1);
    assert.equal(createPreTokens(context.secret, () => expiredAt).read(cookie), null, 'expired two hours on');
  });
});

test('running server.js with an unknown LOG_LEVEL exits non-zero and says why on stderr', (t) => {
  const env = childEnv(t, {
    LOG_LEVEL: 'bogus',
    DATABASE_PATH: path.join(tempDir(t, 'galleryshare-db-'), 'app.sqlite'),
  });
  const child = spawnSync(process.execPath, [SERVER_FILE], { env, encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /LOG_LEVEL must be error, warn, info or debug\./);
});

test(
  'server.js started through a symlinked folder still runs (here: refuses a bad LOG_LEVEL)',
  { skip: process.platform === 'win32' && 'symlinks need privileges' },
  (t) => {
    const link = path.join(tempDir(t, 'galleryshare-link-'), 'current');
    fs.symlinkSync(path.dirname(SERVER_FILE), link, 'dir');
    const env = childEnv(t, { LOG_LEVEL: 'bogus', DATABASE_PATH: ':memory:' });
    const child = spawnSync(process.execPath, [path.join(link, 'server.js')], {
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.notEqual(child.status, 0, 'it ran: a skipped start would exit 0 silently');
    assert.match(child.stderr, /LOG_LEVEL must be error, warn, info or debug\./);
  },
);

test('running server.js with an invalid config exits 1 with one readable error line carrying the stack', (t) => {
  const env = childEnv(t, { NODE_ENV: 'production', SESSION_SECRET: '' });
  const child = spawnSync(process.execPath, [SERVER_FILE], { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(child.status, 1);
  const lines = child.stderr.trim().split('\n');
  assert.equal(lines.length, 1, 'one line on stderr');
  assert.match(lines[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d {2}ERROR {2}Startup failed {2}/);
  assert.match(lines[0], /error=Invalid configuration:/);
  assert.match(lines[0], /stack=.*assertConfig/);
});

test('without PUBLIC_URL the server warns that links follow the request address; with it, no warning', async (t) => {
  const unset = recordingLogger();
  await withServer(t, { logger: unset.logger }, async () => {
    assert.ok(unset.warn.some(([message]) => /PUBLIC_URL is not set/.test(message)));
  });
  const set = recordingLogger();
  await withServer(t, { env: { PUBLIC_URL: 'https://photos.example.com' }, logger: set.logger }, async () => {
    assert.equal(
      set.warn.some(([message]) => /PUBLIC_URL/.test(message)),
      false,
    );
  });
});
