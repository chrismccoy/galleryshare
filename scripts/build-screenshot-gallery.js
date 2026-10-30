import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ejs from 'ejs';
import { SECTIONS } from './shared/screenshot-captions.js';
import { SCREENSHOTS_DIR, VIEWS_DIR } from '../config/root.js';
import { BRAND } from '../config/brand.js';
import { MOBILE_DEVICE, SCREENSHOT_PROJECTS } from './shared/screenshot-projects.js';

const LAYOUT = Object.freeze({
  desktop: { aspect: 'aspect-[16/10]', grid: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' },
  mobile: { aspect: 'aspect-[9/16]', grid: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' },
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderPartial(name, locals) {
  const filename = path.join(VIEWS_DIR, 'partials', `${name}.ejs`);
  return ejs.render(fs.readFileSync(filename, 'utf8'), locals, { filename }).trim();
}

export function capturedOn(dir = SCREENSHOTS_DIR) {
  const times = Object.values(SCREENSHOT_PROJECTS)
    .map((project) => manifestPath(dir, project))
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const { capturedAt } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return capturedAt ? Date.parse(capturedAt) : fs.statSync(file).mtime.getTime();
    });
  return new Date(Math.max(0, ...times)).toISOString().slice(0, 10);
}

const manifestPath = (dir, project) => path.join(dir, project, 'manifest.json');

function readManifest(dir, project) {
  const file = manifestPath(dir, project);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function shotCard(shot, project, position) {
  const href = `${project}/${shot.file}`;
  return renderPartial('share-card', {
    card: {
      href,
      thumbUrl: href,
      title: shot.title,
      caption: shot.text,
      position,
      download: shot.file,
      aspect: LAYOUT[project].aspect,
      crop: 'object-top',
    },
  });
}

function section(heading, intro, cards, grid) {
  return `
    <section class="mb-12">
      <h2 class="mb-1 text-lg font-semibold">${escapeHtml(heading)}</h2>
      <p class="mb-5 text-sm text-muted">${escapeHtml(intro)}</p>
      <div class="grid ${grid} gap-6">
${cards.join('\n')}
      </div>
    </section>`;
}

function buildSections(desktop, mobile) {
  let count = 0;
  const sections = [];
  if (desktop) {
    for (const [key, meta] of Object.entries(SECTIONS)) {
      const shots = desktop.shots.filter((shot) => shot.section === key);
      if (!shots.length) continue;
      const cards = shots.map((shot) => shotCard(shot, SCREENSHOT_PROJECTS.desktop, ++count));
      sections.push(section(meta.heading, meta.intro, cards, LAYOUT.desktop.grid));
    }
  }
  if (mobile) {
    const cards = mobile.shots.map((shot) => shotCard(shot, SCREENSHOT_PROJECTS.mobile, ++count));
    const intro = `The same screens at mobile size (${MOBILE_DEVICE}).`;
    sections.push(section('On a mobile device', intro, cards, LAYOUT.mobile.grid));
  }
  return { sections, count };
}

function pageHtml(sections, captured) {
  const brandIcon = renderPartial('icon', { name: BRAND.icon });
  const lightbox = renderPartial('lightbox', { lightbox: { itemLabel: 'Screenshot', thumbTop: true } });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(BRAND.name)} — Screenshots</title>
  <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="../vendor/fontawesome/css/all.min.css" />
  <link rel="stylesheet" href="gallery.css" />
</head>
<body class="bg-bg text-text antialiased">

  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-6xl items-center gap-3 px-6 py-8">
      <span class="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[17px] text-white">
        ${brandIcon}
      </span>
      <div>
        <h1 class="text-2xl font-semibold">${escapeHtml(BRAND.name)}</h1>
        <p class="mt-0.5 text-sm text-muted">
          Screenshots of every screen, desktop and mobile device, taken by <code>npm run screenshots</code> with generated demo images.
        </p>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-6xl px-6 py-10">
${sections.join('\n')}

  </main>

  <footer class="mt-8 border-t border-slate-200 bg-white">
    <div class="mx-auto max-w-6xl px-6 py-6 text-xs text-muted">
      Captured ${captured}. The pictures are generated scenes, not real photos.
    </div>
  </footer>

${lightbox}
  <script src="../js/lightbox.js"></script>

</body>
</html>
`;
}

export function build({ dir = SCREENSHOTS_DIR } = {}) {
  const desktop = readManifest(dir, SCREENSHOT_PROJECTS.desktop);
  const mobile = readManifest(dir, SCREENSHOT_PROJECTS.mobile);
  if (!desktop && !mobile) throw new Error(`no ${dir}/*/manifest.json found; run \`npm run screenshots\` first`);

  const { sections, count } = buildSections(desktop, mobile);
  fs.writeFileSync(path.join(dir, 'index.html'), pageHtml(sections, capturedOn(dir)));
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  console.log(`${path.relative(process.cwd(), path.join(SCREENSHOTS_DIR, 'index.html'))}: ${build()} shots`);
}
