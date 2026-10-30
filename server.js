import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import express from 'express';
import ejs from 'ejs';
import { assertConfig, loadConfig } from './config/index.js';
import { SCREENSHOTS_PATH, VIEWS_DIR } from './config/root.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrations.js';
import { createAppContext } from './app/context.js';
import { createLogger } from './lib/logger.js';
import { APP_LOCALS } from './routes/view/app-locals.js';
import { requestLocals } from './routes/middleware/request-locals.js';
import { BRAND } from './config/brand.js';
import { securityHeaders } from './routes/middleware/security-headers.js';
import { noFavicon, publicFiles, screenshotFiles } from './routes/middleware/static-files.js';
import { formBodies } from './routes/middleware/body.js';
import { sessionMiddleware } from './routes/middleware/session.js';
import { csrf } from './routes/middleware/csrf.js';
import { requireUser } from './routes/middleware/guards.js';
import { errorHandler, notFoundHandler } from './routes/middleware/errors.js';
import { mountAdminRoutes, mountPublicRoutes, mountUserRoutes } from './routes/index.js';
import {
  HOUSEKEEPING_INTERVAL_MS,
  runBootTasks,
  startHousekeepingTimer,
  startPhashBackfill,
} from './app/boot-tasks.js';
import { systemNow } from './lib/time.js';

export const SHUTDOWN_TIMEOUT_MS = 25_000;

export function createApp(context) {
  const { config, logger, secret, now, authService } = context;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.engine('ejs', ejs.__express);
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);
  app.locals.brand = BRAND;
  Object.assign(app.locals, APP_LOCALS);

  app.use(securityHeaders(config));
  app.use(SCREENSHOTS_PATH, ...screenshotFiles());
  app.use(publicFiles());
  app.get('/favicon.ico', noFavicon);
  const bodies = formBodies();
  app.use(...bodies.beforeSession);
  app.use(sessionMiddleware(authService));
  app.use(bodies.afterSession);
  app.use(csrf({ secret, secure: config.session.cookieSecure, now }));
  app.use(
    requestLocals({
      galleriesService: context.galleriesService,
      sharesService: context.sharesService,
      usersService: context.usersService,
      invitesService: context.invitesService,
      activityService: context.activityService,
    }),
  );

  mountPublicRoutes(app, context);
  app.use(requireUser());
  mountUserRoutes(app, context);
  mountAdminRoutes(app, context);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}

export async function startServer({
  config = loadConfig(),
  now = systemNow,
  logger = createLogger({ now }),
  port,
  host,
  housekeepingIntervalMs = HOUSEKEEPING_INTERVAL_MS,
} = {}) {
  assertConfig(config);
  const db = openDatabase(config.databasePath);
  const bindHost = host ?? config.host;
  let context;
  let server;
  try {
    migrate(db);
    context = createAppContext({ config, db, logger, now });
    await runBootTasks(context, { now });
    const app = createApp(context);
    server = await new Promise((resolve, reject) => {
      const s = app.listen(port ?? config.port, bindHost, (error) => (error ? reject(error) : resolve(s)));
    });
  } catch (error) {
    db.close();
    throw error;
  }
  const shownHost = bindHost.includes(':') ? `[${bindHost}]` : bindHost;
  const address = config.publicUrl ?? `http://${shownHost}:${server.address().port}`;
  logger.info(`${BRAND.name} listening on ${address} (${config.env})`);
  if (!config.publicUrl) {
    logger.warn('PUBLIC_URL is not set: share, invite and reset links use the address each request was sent to.');
  }
  context.activityService.record({ kind: 'serverStarted', actor: 'system', details: address });
  const housekeeping = startHousekeepingTimer(context, { intervalMs: housekeepingIntervalMs, now });
  server.on('close', housekeeping.stop);
  const backfill = startPhashBackfill(context);
  server.on('close', backfill.stop);
  let closing;
  const close = () => {
    closing ??= (async () => {
      context.activityService.record({ kind: 'serverStopped', actor: 'system' });
      housekeeping.stop();
      backfill.stop();
      await new Promise((resolve) => server.close(() => resolve()));
      await context.ingestService.idle();
      await housekeeping.idle();
      await backfill.idle();
      db.close();
    })();
    return closing;
  };
  return { server, context, close };
}

export async function shutdown(signal, { starting, logger, exit = process.exit, timeoutMs = SHUTDOWN_TIMEOUT_MS }) {
  let finishing;
  const finish = (code) =>
    (finishing ??= (async () => {
      try {
        await logger.flush?.();
      } finally {
        exit(code);
      }
    })());
  logger.info(`${signal} received, shutting down`);
  let started;
  try {
    started = await starting;
  } catch {
    return finish(1);
  }
  const deadline = setTimeout(() => {
    logger.error('shutdown timed out', { timeoutMs });
    started.server.closeAllConnections();
    finish(1);
  }, timeoutMs);
  try {
    await started.close();
  } catch (error) {
    clearTimeout(deadline);
    logger.error('shutdown failed', { error: error.message, stack: error.stack });
    return finish(1);
  }
  clearTimeout(deadline);
  return finish(0);
}

function main(logger, config) {
  const starting = startServer({ config, logger });
  starting.catch((error) => {
    logger.error('startup failed', { error: error.message, stack: error.stack, cause: error.cause?.message });
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => shutdown(signal, { starting, logger }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const config = loadConfig();
  const { dir, retentionDays, level } = config.log;
  main(createLogger({ dir, retentionDays, level, color: Boolean(process.stdout.isTTY) }), config);
}
