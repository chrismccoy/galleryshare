import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ejs from 'ejs';
import { PROJECT_ROOT } from '../../config/root.js';
import { APP_LOCALS } from '../../routes/view/app-locals.js';
import { IMAGE_TYPES_TEXT, UPLOAD_ACCEPT, UPLOAD_RULES } from '../../media/image-types.js';
import { uploadHelp } from '../../routes/view/gallery-edit.js';
import { attrsOf, elementByAttr, elementsByTag, tagsWith, textOf } from '../helpers/html.js';
import { BRAND } from '../../config/brand.js';

const render = (name, locals) =>
  ejs.renderFile(path.join(PROJECT_ROOT, 'views', 'partials', `${name}.ejs`), { ...APP_LOCALS, ...locals });

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test('role-select: the select is #role with the given role selected, whatever the page holds', async () => {
  const html = await render('admin/role-select', { selected: 'user', roleSelect: { selected: 'admin' } });
  assert.deepEqual(ids(html), ['role']);
  assert.ok('selected' in attrsOf(html, 'value', 'admin'));
  assert.equal('selected' in attrsOf(html, 'value', 'user'), false);
});

test('pill: each tone gets its class, neutral the plain grey pill', async () => {
  assert.equal(
    (await render('pill', { pill: { text: 'Live', tone: 'green' } })).trim(),
    '<span class="pill pill-green">Live</span>',
  );
  assert.equal(
    (await render('pill', { pill: { text: 'used', tone: 'amber' } })).trim(),
    '<span class="pill pill-amber">used</span>',
  );
  assert.equal(
    (await render('pill', { pill: { text: 'Disabled', tone: 'red' } })).trim(),
    '<span class="pill pill-red">Disabled</span>',
  );
  assert.equal(
    (await render('pill', { pill: { text: 'Latest', tone: 'neutral' } })).trim(),
    '<span class="pill">Latest</span>',
  );
  assert.match(await render('pill', { pill: { text: '<b>', tone: 'green' } }), /&lt;b&gt;/, 'the text is escaped');
});

test('kpi-card: the statistic picks the icon and the tone the tile colour classes', async () => {
  const html = await render('kpi-card', {
    stat: 'storage',
    label: 'Storage used',
    value: '1.0 MB',
    help: 'x',
    tone: 'amber',
  });
  assert.match(html, /data-stat="storage"/);
  assert.match(html, /<i class="fa-solid fa-hard-drive" aria-hidden="true"><\/i>/);
  assert.match(html, /class="[^"]*\bbg-amber-500\/10 text-amber-600"/);
  const shares = await render('kpi-card', { stat: 'shares', label: 'Live links', value: 2, help: 'x', tone: 'sky' });
  assert.match(shares, /fa-solid fa-link/);
  assert.match(shares, /bg-sky-500\/10 text-sky-600/);
});

test('kpi-card: an unknown stat or tone is an error, not an `undefined` class', async () => {
  const card = { stat: 'storage', label: 'L', value: 1, help: 'h', tone: 'amber' };
  await assert.rejects(render('kpi-card', { ...card, stat: 'nope' }), /kpi-card: unknown stat "nope"/);
  await assert.rejects(render('kpi-card', { ...card, tone: 'red' }), /kpi-card: unknown tone "red"/);
});

test('post-button: one POST form with the CSRF field and its button; options add the icon, class and confirm hook', async () => {
  const plain = await render('post-button', {
    csrfToken: 'tok',
    post: { action: '/x/1/enable', label: 'Enable account', btn: 'btn-quiet btn-sm' },
  });
  assert.match(plain, /^<form action="\/x\/1\/enable" method="post">/);
  assert.match(plain, /<input type="hidden" name="_csrf" value="tok" \/>/);
  assert.match(plain, /<button type="submit" class="btn btn-quiet btn-sm">Enable account<\/button>/);
  assert.doesNotMatch(plain, /<i |data-confirm-hide|class="inline"/);
  const full = await render('post-button', {
    csrfToken: 'tok',
    icon: 'fa-solid fa-fire',
    post: {
      action: '/y',
      label: 'Restore',
      btn: 'btn-quiet btn-sm',
      icon: 'fa-solid fa-rotate-left',
      formClass: 'ml-2 inline',
      confirmHide: true,
    },
  });
  assert.match(full, /^<form action="\/y" method="post" class="ml-2 inline" data-confirm-hide>/);
  assert.match(full, /<i class="fa-solid fa-rotate-left" aria-hidden="true"><\/i>/);
  assert.doesNotMatch(full, /fa-fire/);
});

test('admin/link: renders the one-time link when given, nothing for null', async () => {
  const html = await render('admin/link', {
    link: { kind: 'invite', url: 'https://x.test/invite/t', expires: 'soon' },
  });
  assert.match(html, /Copy this invite link now\. It is shown only once and expires soon\./);
  assert.match(html, /value="https:\/\/x\.test\/invite\/t"/);
  assert.equal((await render('admin/link', { link: null })).trim(), '');
});

test('the admin user page sections render from their explicit locals alone', async () => {
  const target = { id: 4, display_name: 'Bob', email: 'bob@example.com', role: 'user', disabled: 0 };
  const profile = await render('admin/user-profile', {
    csrfToken: 'tok',
    target,
    accountStatus: { text: 'Active', tone: 'green' },
    joined: 'today',
    canResetLink: true,
    canEnable: false,
    canDisable: true,
    canDelete: true,
    canChangeRole: true,
    ownAccountNote: false,
  });
  assert.match(profile, /<span class="pill pill-green">Active<\/span>/);
  assert.match(profile, /action="\/admin\/users\/4\/disable"/);
});

test('gallery-upload-forms: the no-JS fallback is a plain form posting images and ZIP files as `files` to the upload route', async () => {
  const upload = uploadHelp({
    maxImageMb: 25,
    maxUploadBatchMb: 1000,
    maxZipUploadMb: 500,
    maxImagesPerGallery: 500,
    userQuotaMb: 0,
  });
  assert.equal(upload.accept, UPLOAD_ACCEPT);
  assert.equal(upload.rules, UPLOAD_RULES);
  assert.equal(
    upload.limitsText,
    `Images: ${IMAGE_TYPES_TEXT}, up to 25 MB each. ZIP files: up to 500 MB each. Up to 1000 MB per upload and 500 images per gallery.`,
  );
  const html = await render('gallery-upload-forms', {
    csrfToken: 'tok',
    uploadAction: '/dashboard/galleries/7/upload',
    upload,
  });
  const noscripts = elementsByTag(html, 'noscript');
  assert.equal(noscripts.length, 1);
  const [noscript] = noscripts;
  const forms = tagsWith(noscript, 'action');
  assert.equal(forms.length, 1, 'one plain form');
  assert.equal(forms[0].name, 'form');
  const form = forms[0].attrs;
  assert.deepEqual(
    [form.action, form.method, form.enctype],
    ['/dashboard/galleries/7/upload', 'post', 'multipart/form-data'],
  );
  const csrfField = attrsOf(noscript, 'name', '_csrf');
  assert.deepEqual([csrfField.tag, csrfField.type, csrfField.value], ['input', 'hidden', 'tok']);
  const input = attrsOf(noscript, 'id', 'upload-files-plain');
  assert.deepEqual([input.tag, input.type, input.name], ['input', 'file', 'files']);
  assert.ok('multiple' in input);
  assert.equal(input.accept, 'image/jpeg,image/png,image/webp,.zip,application/zip');
  const submits = tagsWith(noscript, 'type', 'submit');
  assert.deepEqual(
    submits.map((tag) => tag.name),
    ['button'],
    'one submit button',
  );
  assert.doesNotMatch(noscript, /JavaScript|data-upload/);
  assert.ok(textOf(noscript).includes(upload.limitsText), 'the plain form states the limits');
  assert.ok(textOf(elementByAttr(html, 'data-drop-zone')).includes(upload.limitsText), 'in the same words as the zone');
  const scripted = elementByAttr(html, 'data-upload-form');
  assert.ok(html.indexOf(scripted) < html.indexOf(noscript), 'the JS form comes first');
  const jsForm = attrsOf(scripted, 'data-upload-form');
  assert.deepEqual([jsForm.tag, jsForm.action], ['form', '/dashboard/galleries/7/upload']);
  assert.deepEqual(
    [jsForm['data-max-image-mb'], jsForm['data-max-zip-mb'], jsForm['data-max-batch-mb']],
    ['25', '500', '1000'],
  );
  const jsInput = attrsOf(scripted, 'id', 'upload-files');
  assert.deepEqual([jsInput.tag, jsInput.type, jsInput.name], ['input', 'file', 'files']);
  assert.ok('multiple' in jsInput);
  assert.doesNotMatch(html, /name="(images|archive)"|data-(images|zip)-action/);
});

test('gallery-image-row: the title and caption maxlength come from the fieldMax local', async () => {
  const html = await render('gallery-image-row', {
    csrfToken: 'tok',
    image: { id: 3, title: null, caption: null, position: 1, defaultCaption: 'Image #1' },
    galleryId: 9,
    defaultTitle: 'Title',
    fieldMax: { title: 7, description: 8, caption: 9 },
  });
  const title = attrsOf(html, 'id', 'title-3');
  assert.deepEqual(
    [title.tag, title.name, title.type, title.maxlength, title.form],
    ['input', 'images[3][title]', 'text', '7', 'gallery-details'],
  );
  const caption = attrsOf(html, 'id', 'caption-3');
  assert.deepEqual(
    [caption.tag, caption.name, caption.type, caption.maxlength, caption.form],
    ['input', 'images[3][caption]', 'text', '9', 'gallery-details'],
  );
});

test('gallery-image-row: its fields and Delete belong to the Details form; it has no Save or form of its own', async () => {
  const html = await render('gallery-image-row', {
    csrfToken: 'tok',
    image: { id: 3, title: null, caption: null, position: 1, defaultCaption: 'Image #1' },
    galleryId: 9,
    defaultTitle: 'Title',
    fieldMax: { title: 7, description: 8, caption: 9 },
  });
  assert.equal(tagsWith(html, 'form', 'gallery-details').length, 3, 'the title, the caption and Delete');
  assert.doesNotMatch(html, />\s*Save\s*</, 'no Save button');
  assert.equal(elementsByTag(html, 'form').length, 0, 'no form of its own: Delete waits for Save gallery');
  const remove = attrsOf(html, 'data-remove-image');
  assert.deepEqual(
    [remove.tag, remove.type, remove.name, remove.form],
    ['input', 'checkbox', 'images[3][remove]', 'gallery-details'],
  );
  assert.ok(!('checked' in remove), 'not marked by default');
  const marked = await render('gallery-image-row', {
    csrfToken: 'tok',
    image: { id: 3, title: null, caption: null, position: 1, defaultCaption: 'Image #1', removing: true },
    galleryId: 9,
    defaultTitle: 'Title',
    fieldMax: { title: 7, description: 8, caption: 9 },
  });
  assert.ok('checked' in attrsOf(marked, 'data-remove-image'), 'a refused save keeps the mark');
});

test('notices: takes its messages from one notices object and refuses to inherit page locals', async () => {
  const html = await render('notices', {
    notices: { notice: 'Saved.', noticeLink: { href: '/t', label: 'Open Trash' }, error: 'Broke.' },
  });
  assert.match(html, /role="status"[\s\S]*Saved\.[\s\S]*href="\/t"[\s\S]*Open Trash/);
  assert.match(html, /role="alert"[\s\S]*Broke\./);
  assert.doesNotMatch(await render('notices', { notices: {} }), /notice-/);
  const buttons = tagsWith(html, 'data-dismiss');
  assert.equal(buttons.length, 2, 'each notice has a dismiss button');
  for (const { name, attrs } of buttons) {
    assert.deepEqual([name, attrs.type, attrs['aria-label']], ['button', 'button', 'Dismiss']);
    assert.ok('hidden' in attrs, 'hidden until public/js/dismiss.js shows it');
  }
  await assert.rejects(render('notices', { notice: 'Inherited.' }), /notices: pass \{ notices:/);
});

test('data-table: a heading row and one row partial per item, or the empty state', async () => {
  const table = {
    columns: [{ label: 'Name' }, { label: 'Actions', srOnly: true, class: 'text-right' }],
    row: 'rows/share-view',
    empty: { icon: 'fa-solid fa-link', text: 'Nothing here.' },
  };
  const rows = [{ when: 'today', kind: 'Page', ip: '203.0.113.1', userAgent: 'UA' }];
  const full = await render('data-table', { table: { ...table, rows } });
  assert.match(
    full,
    /<thead><tr><th>Name<\/th><th class="text-right"><span class="sr-only">Actions<\/span><\/th><\/tr><\/thead>/,
  );
  assert.equal(full.match(/data-view-row/g).length, 1);
  assert.doesNotMatch(full, /data-empty-state/);
  const empty = await render('data-table', { table: { ...table, rows: [] } });
  assert.doesNotMatch(empty, /<table/);
  assert.match(empty, /data-empty-state[\s\S]*Nothing here\./);
  assert.equal((await render('data-table', { table: { ...table, empty: undefined, rows: [] } })).trim(), '');
});

test('rows/gallery: the admin list shows the owner and Move to Trash, My galleries the cover and the admin pill', async () => {
  const item = { id: 3, title: 'Trip', owner: 'Olive', imageCount: 2, size: '1 MB', created: 'today', shared: true };
  const mine = await render('rows/gallery', { csrfToken: 'tok', admin: false, item: { ...item, editedByAdmin: true } });
  assert.match(mine, /data-edited-by-admin/);
  assert.doesNotMatch(mine, /Olive/);
  assert.match(mine, /<\/i>\s*Delete\s*<\/button>/);
  const admin = await render('rows/gallery', {
    csrfToken: 'tok',
    admin: true,
    item: { ...item, editedByAdmin: true },
  });
  assert.match(admin, /<td>Olive<\/td>/);
  assert.doesNotMatch(admin, /data-edited-by-admin/);
  assert.match(admin, /<\/i>\s*Move to Trash\s*<\/button>/);
  for (const html of [mine, admin]) assert.match(html, /data-shared-pill/);
});

test('danger-confirm: the tooltip comes only from its own object, never from the page title', async () => {
  const confirm = { icon: 'fa-solid fa-fire', label: 'Empty trash', action: '/x', prompt: 'Sure?' };
  const pageTitled = await render('danger-confirm', { title: 'Trash', csrfToken: 't', confirm });
  assert.equal('title' in attrsOf(pageTitled, 'data-confirm-open'), false, "the page's title is not a tooltip");
  const tipped = await render('danger-confirm', {
    title: 'Trash',
    csrfToken: 't',
    confirm: { ...confirm, tooltip: 'Revoke' },
  });
  assert.equal(attrsOf(tipped, 'data-confirm-open').title, 'Revoke');
  assert.match(textOf(elementByAttr(tipped, 'data-confirm-panel')), /Sure\?/);
});

test("icon: a partial's own extra classes never leak into the icon inside it", async () => {
  const html = await render('edited-by-admin-pill', { pill: { extra: 'ml-1.5' } });
  assert.match(attrsOf(html, 'data-edited-by-admin').class, /\bml-1\.5\b/, 'the pill gets the margin');
  assert.equal(elementsByTag(html, 'i')[0].match(/class="([^"]+)"/)[1], 'fa-solid fa-user-shield', 'its icon does not');
  assert.match(
    await render('icon', { name: 'fa-solid fa-x', iconExtra: 'text-red-500' }),
    /class="fa-solid fa-x text-red-500"/,
  );
});

test("pager: renders only from its own olderUrl, not the page's", async () => {
  assert.equal((await render('pager', { olderUrl: '/page?before=9', pager: { olderUrl: null } })).trim(), '');
  const html = await render('pager', { pager: { olderUrl: '/g?before=5', label: 'Older galleries' } });
  assert.equal(attrsOf(html, 'href', '/g?before=5').tag, 'a');
  assert.match(html, /Older galleries/);
  assert.match(await render('pager', { pager: { olderUrl: '/g' } }), /Older results/);
});

test("toggle: reads only its own object, so the page's title never names the switch", async () => {
  const html = await render('toggle', {
    title: 'Settings',
    help: 'page help',
    toggle: { name: 'allow_zip', title: 'Allow ZIP download', checked: true },
  });
  const box = attrsOf(html, 'name', 'allow_zip');
  assert.equal(box['aria-label'], 'Allow ZIP download');
  assert.ok('checked' in box);
  assert.doesNotMatch(html, /page help|>Settings</, 'nothing comes from the page');
  assert.match(
    await render('toggle', { toggle: { name: 'x', title: 'X', checked: false, help: 'Own help' } }),
    /Own help/,
  );
});

test('empty-state and state-panel: links and notes come only from their own object', async () => {
  const pageLink = { href: '/page-link', label: 'Page link' };
  const empty = await render('empty-state', {
    link: pageLink,
    note: 'page note',
    empty: { icon: 'fa-solid fa-x', text: 'None' },
  });
  assert.doesNotMatch(empty, /page-link|page note/);
  assert.match(empty, /None/);
  const linked = await render('empty-state', {
    empty: { icon: 'fa-solid fa-x', text: 'None', link: { href: '/add', label: 'Add' } },
  });
  assert.equal(attrsOf(linked, 'href', '/add').tag, 'a');
  const state = await render('state-panel', {
    link: pageLink,
    help: 'page help',
    state: { tone: 'red', icon: 'fa-solid fa-x', heading: 'Gone' },
  });
  assert.doesNotMatch(state, /page-link|page help/);
  assert.match(state, /state-red/);
});

test('pills and the confirm panel read only their own object', async () => {
  assert.equal(
    attrsOf(await render('shared-pill', { extra: 'page-x', pill: {} }), 'data-shared-pill').class,
    'pill pill-green',
  );
  assert.match(attrsOf(await render('shared-pill', { pill: { extra: 'mt-1' } }), 'data-shared-pill').class, /\bmt-1\b/);
  assert.equal(
    attrsOf(await render('edited-by-admin-pill', { extra: 'page-x', pill: {} }), 'data-edited-by-admin').class,
    'pill pill-amber',
  );
  const panel = await render('confirm-panel', { prompt: 'Page prompt?', csrfToken: 't', confirm: { action: '/do' } });
  assert.match(textOf(elementByAttr(panel, 'data-confirm-panel')), /Delete\?/);
  assert.doesNotMatch(panel, /Page prompt/);
  assert.equal(attrsOf(panel, 'action', '/do').tag, 'form');
});

test('rows/invite and rows/user read the one status shape { key?, text, tone }', async () => {
  const invite = {
    id: 3,
    label: 'Ann',
    role: 'user',
    status: { key: 'pending', text: 'pending', tone: 'amber' },
    created: 'a',
    expires: 'b',
    url: null,
  };
  const pending = await render('rows/invite', { csrfToken: 't', item: invite });
  assert.match(pending, /<span class="pill pill-amber">pending<\/span>/);
  assert.match(pending, /Revoke/);
  const used = await render('rows/invite', {
    csrfToken: 't',
    item: { ...invite, status: { key: 'used', text: 'used', tone: 'neutral' } },
  });
  assert.doesNotMatch(used, /Revoke/);
  const user = {
    id: 4,
    name: 'Bob',
    email: 'b@x.co',
    role: 'user',
    status: { text: 'Disabled', tone: 'red' },
    joined: 'j',
  };
  assert.match(await render('rows/user', { item: user }), /<span class="pill pill-red">Disabled<\/span>/);
});

test('panel-head takes one object: a page local named heading or icon does not reach it', async () => {
  const html = await render('public/panel-head', {
    brand: BRAND,
    heading: 'Page heading',
    icon: 'fa-solid fa-bomb',
    head: { sub: 'Sign in to continue.' },
  });
  assert.match(html, new RegExp(`>${BRAND.name}</h1>`), 'the brand name, not the page heading');
  assert.doesNotMatch(html, /fa-bomb|Page heading/);
  assert.match(html, /Sign in to continue\./);
});
