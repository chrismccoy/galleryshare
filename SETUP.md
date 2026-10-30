# GalleryShare setup

How to install, configure, run and test GalleryShare. For what the app does, see [README.md](README.md).

## Limits

Every upload limit has a default in `.env`. Admin → Settings can override each one with its "Use custom …" switch and a saved value; the change applies to the next upload, with no restart. A field with nothing saved shows the `.env` value; saved unchanged while its switch is off, it is not stored, so a later `.env` change still shows. Over any limit the whole upload is refused before anything is stored, with a message naming the limit.

| Variable | Default | Range | What it limits |
| --- | --- | --- | --- |
| `MAX_IMAGE_MB` | `25` | 1 to 200 | one image file, also each image inside a ZIP |
| `MAX_ZIP_UPLOAD_MB` | `500` | 1 to 5000 | each uploaded ZIP file (its images may total twice this, uncompressed); `MAX_UPLOAD_BATCH_MB` still caps the whole upload, so a ZIP larger than the batch limit is refused even on its own |
| `MAX_IMAGES_PER_GALLERY` | `500` | 1 to 5000 | images in one gallery, counting uploads still being added |
| `USER_QUOTA_MB` | `0` (unlimited) | 0 to 10000000 | storage per user, counting uploads still being added |
| `MAX_UPLOAD_BATCH_MB` | `1000` | 1 to 10000 | the total of one upload: all images and ZIP files together, as uploaded |
| `RATE_LIMIT_ZIP_MAX` | `5` | 1 or more | ZIP downloads per IP address per `RATE_LIMIT_WINDOW_MS` (`.env` only, not in Settings) |

Fixed safety caps (not configurable): a ZIP may hold at most 10,000 entries of any kind (or 4 × `MAX_IMAGES_PER_GALLERY` if that is higher), and one upload may contain at most 100 files that are named like images but are not real JPEG, PNG or WebP images. An upload over either cap is refused before anything is stored. Other files in a ZIP (text files, `__MACOSX/`, hidden files) are ignored silently. A gallery's skipped-files list names at most 100 files and counts the rest.

## Requirements

- Node.js 22 or newer (`node --version`).
- npm (comes with Node).
- For browser tests and screenshots only: Playwright's Chromium (`npx playwright install chromium`).

## Setup

1. Install the dependencies and create your `.env`:

   ```bash
   npm install
   cp .env.example .env
   ```

2. Generate two secrets. Run this command twice and paste one value into `SESSION_SECRET` and the other into `SETTINGS_ENC_KEY`:

   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
   ```

   `SESSION_SECRET` signs form tokens and derives share links. Outside production the app starts without it, using a random secret for that process and logging a warning; share links and open sign-in forms then stop working at every restart, so set it. In production it is required. Changing it later keeps links already sent working, but they can no longer be shown again for Copy.

   `SETTINGS_ENC_KEY` encrypts pending invite links so Admin → Invites can copy them again. Without it invite links are shown once only.

3. Set the owner admin in `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 10 characters) and, optionally, `ADMIN_NAME`. The app creates this admin at every start, or makes it an enabled admin again.

4. Choose where data lives, or keep the defaults: `DATABASE_PATH` (`./data/galleryshare.sqlite`), `MEDIA_DIR` (`./data/media`, the image files) and `TMP_UPLOAD_DIR` (`./data/tmp`, uploads while they are processed). `TMP_UPLOAD_DIR` must be a folder of its own, not `MEDIA_DIR` or inside it, and must not hold the database: leftover files in it are removed at every start. Back up the database and `MEDIA_DIR` together.

5. Start the app:

   ```bash
   npm run dev
   ```

   This builds the stylesheet and serves on `http://127.0.0.1:3000`, restarting when files change. For a plain start use `npm run build:css` once, then `npm start`.

6. Open `http://127.0.0.1:3000`, sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and choose **Add gallery**.

### Adding people

There is no public sign-up and nothing is emailed.

1. Admin → Invites → choose User or Admin, add an optional label, **Create invite**.
2. Send the link yourself. It works once and expires after 7 days. **Copy** on the list gets it again later (needs `SETTINGS_ENC_KEY`).
3. A user who forgot their password: Admin → Users → **Manage** → **Generate reset link** (24 hours; it replaces any earlier unused link) and send it.

### Production

Set `NODE_ENV=production`, `PUBLIC_URL` (the base of invite, reset and share links), `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`; the app refuses to start without them. Run `npm run build:css` and `npm start` behind a reverse proxy such as nginx with `TRUST_PROXY=1`, which also makes the session cookie Secure. Let the proxy accept request bodies as large as your biggest upload limit (for nginx, `client_max_body_size`).

### Upgrading

1. Stop the server and back up the database (`DATABASE_PATH`) and `MEDIA_DIR`.
2. Update the code, run `npm install` and `npm run build:css`, then start the server. Pending migrations run automatically at start, each in its own transaction.

Migration 2 renames `sessions.token` to `token_hash`. Sessions are kept, so nobody is signed out. Code from before it cannot run on a migrated database. To downgrade, restore the backup. For this migration only, you can instead run `ALTER TABLE sessions RENAME COLUMN token_hash TO token;` and `DELETE FROM schema_migrations WHERE version = 2;` with the server stopped.

Migration 3 adds `gallery_images.phash`, the perceptual hash used to skip images already in a gallery. Images stored before it are hashed in the background after the server starts (from their web copy), which logs `hashed existing images for the duplicate check` with a count when done; until then those images are not part of the duplicate check. The server starts at once and stops the hashing cleanly on shutdown.

Migration 4 adds `galleries.grid_text`, each gallery's "Titles and captions on the grid" choice. Existing galleries get "Site default", so they follow `SHARE_GRID_TEXT` and its Settings override.

Migration 5 adds the `activity` table behind the Activity pages. Nothing is backfilled: activity starts when the upgraded server starts, and earlier actions do not appear.

Migration 6 adds `galleries.share_theme`, each gallery's "Share theme" choice, and migration 7 adds `galleries.image_view`, its "Image view" choice. Existing galleries get "Site default" for both, so they follow `SHARE_THEME` and `SHARE_IMAGE_VIEW` and their Settings overrides; with the defaults (`none` and `lightbox`) shared pages look as before.

Code from before migrations 3 to 7 ignores the new columns and table, so an older version still runs on an upgraded database, but restoring the backup is the safe way back.

### Demo data

To try the app with demo content, stop the server and run:

```bash
npm run seed:demo
```

It writes to the database in `DATABASE_PATH` and the folder in `MEDIA_DIR`:

1. Copies the database to `backup-before-demo-<timestamp>.sqlite` in the same folder.
2. Runs the migrations and syncs the `.env` admin, as a server start does.
3. Writes the demo data through the app's own repositories and services, with generated pictures (no image files are shipped):
   - 3 users (`maya`, `jonas` and `priya` `@demo.galleryshare.test`, password `demo-password-2026`).
   - 6 galleries of 1 to 24 images in all three formats, some with titles and captions; one is shared (with ZIP download on and some recorded views) and one is in Trash.
   - One pending invite.
   - About six weeks of back-dated activity for Admin → Activity and each user's My activity: invites used and sign-ins, galleries created, filled, edited, shared and trashed, visits and ZIP downloads, an admin editing Maya's gallery and sending Jonas a reset link (shown to them as "An admin"), failed sign-ins and a rate limit, a settings switch turned on and back off, and a server restart. The newest System row, "Demo data written", is stamped with the time of the run.

**The demo accounts use the public password above. Use demo data on your own machine only, never on a server others can reach.** `npm run seed:demo` refuses to run when `NODE_ENV=production` and writes nothing.

A second run sees the demo users and writes nothing. If a run fails part-way, the demo users, galleries and image files it made are removed again.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm start` | `node server.js` (does not build CSS) |
| `npm run dev` | builds the CSS, then runs `node --watch server.js` (restarts on file changes) |
| `npm run build:css` | builds `public/css/app.css` with Tailwind (`tailwind.config.js`) from `src/tailwind.css`, which imports `src/share-gallery.css` and `src/share-themes.css` |
| `npm run dev:css` | rebuilds `public/css/app.css` whenever a view or stylesheet changes (run beside `npm run dev` while editing views) |
| `npm test` | node:test suite (`test/**/*.test.js`) |
| `npm run test:e2e` | Playwright browser tests (`:headed` and `:ui` variants too) |
| `npm run seed:demo` | backs up your database, then fills it with demo data (see [Demo data](#demo-data)) |
| `npm run screenshots` | captures every screen, desktop and mobile, then builds the gallery |
| `npm run build:screenshots` | rebuilds the screenshot gallery page and its CSS (`tailwind.screenshots.config.js`, from `src/gallery/gallery.css`, which shares `src/share-gallery.css`: the image card, the lightbox buttons and the `[hidden]` rule) from the last capture |
| `npm run format` | formats all JavaScript with Prettier (`.prettierrc.json`); `npm run format:check` only checks |

## Configuration

Every setting lives in `.env` (see `.env.example`). A malformed number falls back to its default; unsafe settings (a bad `SETTINGS_ENC_KEY`, a `TMP_UPLOAD_DIR` that overlaps `MEDIA_DIR` or the database, missing production secrets) stop the app at start-up.

| Variable | Default | What it does |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` requires the secrets, the admin pair and `PUBLIC_URL` |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | where the app listens (`PORT` 1 to 65535) |
| `TRUST_PROXY` | off | `1` behind nginx; also makes the session cookie Secure |
| `PUBLIC_URL` | | base of invite, reset and share links, an absolute `http` or `https` address; required in production (elsewhere links use the request host, and the server warns at start) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | | the owner admin, synced at every start (role, enabled, password); `ADMIN_NAME` names the account when it is created, at most 80 characters |
| `SESSION_SECRET` | | signs anonymous form tokens and derives share links; required in production |
| `SESSION_DAYS` | `30` | how long a sign-in lasts, in days (1 to 3650) |
| `COOKIE_SECURE` | `false` | `true` (or `yes`, `on`, `1`) forces Secure cookies (always on in production or behind a trusted proxy) |
| `SETTINGS_ENC_KEY` | | encrypts the invite links kept for Copy |
| `DATABASE_PATH` | `./data/galleryshare.sqlite` | SQLite file (or `:memory:`); a relative path is resolved from the project folder; `file:` URIs are refused |
| `MEDIA_DIR` | `./data/media` | image files: `<gallery id>/orig`, `web` and `thumb` |
| `TMP_UPLOAD_DIR` | `./data/tmp` | uploads while they are processed; a separate folder, emptied at start |
| `RATE_LIMIT_PUBLIC_FORM_MAX` | `10` | sign-in, invite and reset submissions per IP per window |
| `RATE_LIMIT_SHARE_MAX` | the public-form limit | failed share-link lookups (wrong, revoked or paused `/s/<token>` links, pages and images) per IP per window; requests under a valid link are never counted or refused |
| `RATE_LIMIT_ZIP_MAX` | `5` | ZIP downloads per IP per window |
| `RATE_LIMIT_WINDOW_MS` | `900000` | the rate-limit window (at most `86400000`, one day) |
| `TRASH_RETENTION_DAYS` | `30` | days before a gallery in Trash is deleted for good (at most 3650) |
| `ACTIVITY_RETENTION_DAYS` | `90` | days the Activity pages keep events (at most 3650) |
| `LOG_DIR` | `./data/logs` | folder for the daily log files; a relative path is resolved from the project folder |
| `LOG_RETENTION_DAYS` | `30` | days a log file is kept (1 to 3650) |
| `LOG_LEVEL` | `info` | least important level the console shows: `error`, `warn`, `info` or `debug`; the log files are not affected |
| `SHARE_GRID_TEXT` | `true` | `false` shows only thumbnails on a shared gallery grid (the lightbox and single-image galleries still show titles and captions); Settings can override it, and each gallery can override that in its Details |
| `SHARE_THEME` | `none` | look of shared gallery pages: `none` (plain), `frame`, `dark-wall`, `app-window`, `polaroid`, `glass` or `paper-stack`; Settings can override it, and each gallery can override that in its Details |
| `SHARE_IMAGE_VIEW` | `lightbox` | what a click on a shared thumbnail does: `lightbox`, `new-tab` (the large image alone in a new tab) or `page` (each image on a page of its own, in the gallery's theme, with Previous and Next); Settings can override it, and each gallery can override that in its Details |
| `ITEMS_PER_PAGE` | `25` | rows per page in My galleries, Trash, My activity, Admin → Galleries, Shared links and Activity (5 to 100); Settings can override it |
| `MAX_IMAGE_MB`, `MAX_ZIP_UPLOAD_MB`, `MAX_IMAGES_PER_GALLERY`, `USER_QUOTA_MB`, `MAX_UPLOAD_BATCH_MB` | see [Limits](#limits) | upload limits; Settings can override each |

## Logs

Logging uses [Winston](https://github.com/winstonjs/winston), with [winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file) for the daily files. The server writes one readable line per event to the console:

```
2026-11-02 14:03:07  INFO   Signed in  by ann@example.com from 203.0.113.7  area=accounts  kind=signedIn
2026-11-02 14:05:41  INFO   Gallery created  "Untitled gallery" by ann@example.com  area=galleries  kind=galleryCreated
```

The columns are the time, the level, the event, a short summary and a few `key=value` fields. The level is coloured only when the console is a terminal. Times are UTC.

The same events are also written as JSON lines to one file per day, `app-YYYY-MM-DD.log` in `LOG_DIR`. File dates are UTC. Files older than `LOG_RETENTION_DAYS` days are deleted. `LOG_LEVEL` sets what the console shows; the files always take `info` and above. Passwords, tokens, cookies, share, invite and reset links and `SETTINGS_ENC_KEY` are never logged: a field that looks like a secret is written as `[redacted]`, and an error on a share, invite or reset URL is logged with the route (`/s/:token`), not the link. Control characters typed into a form are removed from console lines.

If `LOG_DIR` cannot be written, the server still starts, logs to the console only, and warns once.

On shutdown the server writes out the log file before it exits (waiting at most a second), so the last lines, such as `Server stopped` or `shutdown timed out`, are not lost.

`npm run seed:demo` prints its progress in the same console format; it writes no log files.

What the Activity pages show is kept separately in the database for `ACTIVITY_RETENTION_DAYS` days.

## Tests

`npm test` runs the node:test suite: config, domain rules, metadata stripping on fixture images, the database, services, every route and the demo seed, plus guards on the code itself: a JSDoc block on every function (and JSDoc type paths that point at real files), no unused imports, routes reaching the database only through services, every route with an id or token declared in `config/urls.js`, no Tailwind or Font Awesome classes in routes, and `.env.example` listing every setting. It uses temporary databases and folders; your `.env` is not used.

### Browser tests

The Playwright suite in `test/e2e/` drives the real app in Chromium on a desktop viewport, and runs `test/e2e/mobile.spec.js` on a Pixel 7 mobile device viewport (the edit view, the shared grid and lightbox, the single-image page, and every share theme with its image page). Install the browser once, then run it:

```bash
npx playwright install chromium
npm run test:e2e          # headless, all projects
npm run test:e2e:headed   # desktop Chromium, visible window
npm run test:e2e:ui       # Playwright's interactive UI
```

The specs cover sign-in and invites (including a revoked invite); disabling, enabling, role changes and deleting users; changing your password; Admin → Galleries with its owner filter and "Edited by an admin"; Settings overrides, lowered limits and the Settings save bar; upload, job page, the "Images added and saved." notice, edit view, titles, drag-and-drop reorder, Delete with Undo, the save bar and the leave dialog; skipping a picture already in the gallery; share, the share link's Copy, lightbox, Save, Copy image link, ZIP download (entry names checked), the single-image page and revoke; a link's admin page with its views; every share theme, the New tab and Image page views and their Settings overrides; sharing switched off and an admin revoke; Trash; Activity, My activity, their filters and the Recent activity cards; paging back through long lists; the sidebar layout and its count badges; and closing a notice. Each run creates a temp directory (`galleryshare-e2e-<pid>` under the system temp folder) holding a fresh database, media and upload folders, and runs the app in it; the directory is removed when the run ends, and leftovers of crashed runs are cleared at the start of the next one. The app's settings come from `playwright.config.js`, not your `.env`: it sets `GALLERYSHARE_SKIP_ENV_FILE=1`. A test fails if the page logs a console error, throws, or violates the Content Security Policy. Port 3310 can be changed with `E2E_PORT`.

### Screenshots

```bash
npm run screenshots
```

Uses the same throwaway server, fills the app with generated demo images through the UI, and saves a JPEG of every screen to `public/screenshots/desktop/` (1440×900) and `public/screenshots/mobile/` (Pixel 7), numbered in visit order, then builds the gallery. Each run replaces the previous set.

The gallery is served at **`/screenshots/`** with no sign-in (it shows demo data only, and sends `X-Robots-Tag: noindex`); you can also open `public/screenshots/index.html` directly. Click a card for the lightbox, use ← → to step through every shot and Esc to close. Titles and captions live in `scripts/shared/screenshot-captions.js` (a shot without a caption fails the run).
