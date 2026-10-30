import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, assertConfig } from '../config/index.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { createAppContext, createRepositories } from '../app/context.js';
import { syncEnvAdmin } from '../app/env-admin-sync.js';
import { hashPassword } from '../lib/password.js';
import { processImage } from '../media/image.js';
import { createLogger } from '../lib/logger.js';
import { MS_PER_DAY } from '../lib/time.js';
import { USER, isAdmin } from '../domain/roles.js';
import { DEMO_FORMATS, demoImage } from './shared/demo-images.js';
import { DEMO_DOMAIN, DEMO_INVITE_LABEL, DEMO_PASSWORD, DEMO_USERS } from './seed-demo/data.js';
import { demoActivity, demoVisitor, writeDemoActivity } from './seed-demo/activity.js';
import { OVERRIDE_SWITCHES } from '../domain/settings.js';
import { gridTextColumn } from '../domain/gallery.js';
import { FOLLOW_SITE } from '../domain/gallery-choice.js';

const IMAGE_SIZE = Object.freeze({ width: 1200, height: 800 });

const FIRST_FILE_NUMBER = 2040;

function openUnseededDatabase(config) {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = openDatabase(config.databasePath);
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (hasUsers && db.prepare('SELECT 1 FROM users WHERE email LIKE ?').get(`%@${DEMO_DOMAIN}`)) {
    db.close();
    return null;
  }
  return db;
}

async function backUp(db, databasePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(path.dirname(databasePath), `backup-before-demo-${stamp}.sqlite`);
  await db.backup(backupPath);
  return backupPath;
}

const daysAgo = (days) => new Date(Date.now() - days * MS_PER_DAY).toISOString();

function applyLifecycle(ctx, owner, id, spec) {
  const { galleries, sharesService, shares } = ctx;
  galleries.backdate(id, daysAgo(spec.createdDaysAgo));
  if (spec.shared) {
    sharesService.share(owner, id);
    const live = shares.liveForGallery(id);
    for (let v = 0; v < spec.shared.views; v++) {
      shares.recordView(live.id, demoVisitor(v));
    }
  }
  if (spec.trashed) galleries.trashOwned(id, owner.id);
}

async function seedGallery(ctx, owner, spec, sceneIndex) {
  const { galleries, galleryImages, galleriesService } = ctx;
  const id = galleries.insert({ userId: owner.id });
  galleries.updateMeta(id, {
    title: spec.title,
    description: spec.description,
    allowZip: Boolean(spec.allowZip),
    gridText: gridTextColumn(spec.gridText ?? FOLLOW_SITE),
    actorId: owner.id,
  });
  for (let i = 0; i < spec.images; i++) {
    const format = DEMO_FORMATS[i % DEMO_FORMATS.length];
    const processed = await processImage(await demoImage(sceneIndex + i, { ...IMAGE_SIZE, format }));
    const originalName = `${spec.prefix}${String(FIRST_FILE_NUMBER + i).padStart(4, '0')}.${format}`;
    const imageId = await galleriesService.addProcessedImage(id, { originalName, processed });
    const [title, caption] = spec.texts[i] ?? [];
    if (title || caption) galleryImages.update(imageId, { title, caption });
  }
  applyLifecycle(ctx, owner, id, spec);
  return id;
}

async function removeDemoUsers(ctx, userIds) {
  for (const id of userIds) {
    const galleryIds = ctx.galleriesService.idsForUser(id);
    ctx.users.remove(id);
    await ctx.galleriesService.removeMedia(galleryIds);
  }
}

function countSeededRows(ctx) {
  const stats = ctx.statsService.overview();
  return {
    users: stats.users,
    galleries: stats.galleries,
    trashed: stats.trashed,
    images: stats.images,
    shared: stats.liveShares,
  };
}

async function seedUsersOrRollBack(ctx, db, admin) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const created = [];
  const activityBefore = ctx.activity.lastId();
  try {
    let scene = 0;
    const people = [];
    const galleries = [];
    for (const person of DEMO_USERS) {
      const id = ctx.users.insert({
        email: `${person.first}@${DEMO_DOMAIN}`,
        displayName: person.name,
        passwordHash,
        role: USER,
      });
      created.push(id);
      ctx.users.backdate(id, daysAgo(person.joinedDaysAgo));
      const owner = ctx.users.byId(id);
      people.push({ user: owner, joinedDaysAgo: person.joinedDaysAgo });
      for (const spec of person.galleries) {
        galleries.push({ id: await seedGallery(ctx, owner, spec, scene), owner, spec });
        scene += spec.images;
      }
    }
    ctx.invitesService.create({ role: USER, label: DEMO_INVITE_LABEL, createdBy: admin.id });
    const switches = ctx.settingsService.current().switches;
    const events = demoActivity({
      admin,
      people,
      galleries,
      inviteLabel: DEMO_INVITE_LABEL,
      switchTitles: OVERRIDE_SWITCHES.filter(({ name }) => !switches[name]).map(({ title }) => title),
      serverUrl: ctx.config.publicUrl ?? `http://${ctx.config.host}:${ctx.config.port}`,
    });
    ctx.activity.deleteAfter(activityBefore);
    const written = writeDemoActivity(db, ctx, events);
    const images = galleries.reduce((total, { spec }) => total + spec.images, 0);
    ctx.activityService.record({
      kind: 'demoSeeded',
      actor: 'system',
      details: `${people.length} users, ${galleries.length} galleries, ${images} images, ${written} activity events`,
    });
    return written;
  } catch (error) {
    ctx.activity.deleteAfter(activityBefore);
    await removeDemoUsers(ctx, created);
    throw error;
  }
}

export const PRODUCTION_REFUSAL =
  'Refusing to write demo data with NODE_ENV=production: the demo accounts use a public password. Nothing was written.';

const withoutActivityLines = (logger) => ({
  ...logger,
  info: (message, fields) => {
    if (!fields?.kind) logger.info(message, fields);
  },
});

export async function main({ logger = createLogger({ color: Boolean(process.stdout.isTTY) }) } = {}) {
  const config = loadConfig();
  if (config.isProduction) throw new Error(PRODUCTION_REFUSAL);
  assertConfig(config);
  const db = openUnseededDatabase(config);
  if (!db) {
    logger.info('Demo data already present; nothing written', { database: config.databasePath });
    return;
  }
  try {
    logger.info('Backup written', { file: await backUp(db, config.databasePath) });
    migrate(db);
    logger.info('Migrations applied');

    const repositories = createRepositories(db);
    const context = createAppContext({ config, db, logger: withoutActivityLines(logger), repositories });
    const ctx = { ...repositories, ...context };
    await syncEnvAdmin(ctx);
    const admin = config.admin?.email ? ctx.users.byEmail(config.admin.email) : ctx.users.all().find(isAdmin);
    if (!admin) throw new Error('No admin account found; set ADMIN_EMAIL and ADMIN_PASSWORD in .env.');

    const activity = await seedUsersOrRollBack(ctx, db, admin);
    logger.info('Demo data written', { ...countSeededRows(ctx), activity });
    logger.info('Demo sign-in', {
      summary: `${DEMO_USERS.map((person) => person.first).join(', ')} @${DEMO_DOMAIN} with password ${DEMO_PASSWORD}`,
    });
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const logger = createLogger({ color: Boolean(process.stdout.isTTY) });
  try {
    await main({ logger });
  } catch (error) {
    if (error.message === PRODUCTION_REFUSAL) logger.error(PRODUCTION_REFUSAL);
    else logger.error('Demo seed failed', { error: error.message, cause: error.cause?.message });
    process.exitCode = 1;
  }
}
