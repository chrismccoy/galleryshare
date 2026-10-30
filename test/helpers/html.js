const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function blankComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
}

function parseAttributes(raw) {
  const attrs = {};
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}


export function startTags(html) {
  const tags = [];
  for (const match of blankComments(html).matchAll(START_TAG)) {
    tags.push({
      name: match[1].toLowerCase(),
      attrs: parseAttributes(match[2]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tags;
}

function carries(tag, attr, value) {
  const name = attr.toLowerCase();
  if (!(name in tag.attrs)) return false;
  return value === undefined || tag.attrs[name] === String(value);
}

export function tagsWith(html, attr, value) {
  return startTags(html).filter((tag) => carries(tag, attr, value));
}

export function attrsOf(html, attr, value) {
  const [first] = tagsWith(html, attr, value);
  if (!first) return null;
  return { tag: first.name, ...first.attrs };
}

export function allAttrValues(html, attr) {
  return tagsWith(html, attr).map((tag) => tag.attrs[attr.toLowerCase()]);
}

function elementEnd(html, tag) {
  if (VOID_ELEMENTS.has(tag.name) || html[tag.end - 2] === '/') return tag.end;
  const pattern = new RegExp(`<(/?)${tag.name}(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
  pattern.lastIndex = tag.end;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  throw new Error(`<${tag.name}> at offset ${tag.start} is never closed`);
}

export function elementsWhere(html, predicate) {
  const blanked = blankComments(html);
  return startTags(html)
    .filter(predicate)
    .map((tag) => html.slice(tag.start, elementEnd(blanked, tag)));
}

export function elementsByAttr(html, attr, value) {
  return elementsWhere(html, (tag) => carries(tag, attr, value));
}

export function elementByAttr(html, attr, value) {
  return elementsByAttr(html, attr, value)[0] ?? null;
}

export function elementsByTag(html, name) {
  const lower = name.toLowerCase();
  return elementsWhere(html, (tag) => tag.name === lower);
}

export function elementsByClass(html, token) {
  return elementsWhere(html, (tag) => classesOf(tag.attrs).includes(token));
}

export function statValue(html, stat) {
  const tile = elementByAttr(html, 'data-stat', stat);
  if (!tile) return null;
  const values = elementsByClass(tile, 'kpi-value');
  return values.length === 1 ? textOf(values[0]) : null;
}

export function textOf(fragment) {
  return decodeEntities(
    blankComments(fragment)
      .replace(START_TAG, '')
      .replace(/<\/[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function classesOf(attrs) {
  return (attrs?.class ?? '').split(/\s+/).filter(Boolean);
}

export function stripCsrfMeta(html) {
  return html.replace(/<meta\b[^>]*\bname="csrf-token"[^>]*>/, '');
}

export function csrfFromHtml(html) {
  return tagsWith(html, 'name', '_csrf')[0]?.attrs.value ?? null;
}

export function countAttr(html, name) {
  return (html.match(new RegExp(`(?<![\\w-])${name}(?=[\\s=>/])`, 'g')) ?? []).length;
}

export function navCount(html, key) {
  const badge = elementByAttr(html, 'data-nav-count', key);
  return badge === null ? null : textOf(badge).trim();
}

export function olderHref(html) {
  const pager = elementByAttr(html, 'aria-label', 'Pages');
  return pager === null ? null : (attrsOf(pager, 'href')?.href ?? null);
}

export function summaryValue(html, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<dt[^>]*>${escaped}</dt>\\s*<dd[^>]*>([^<]*)<`).exec(html)?.[1].trim() ?? null;
}

export function inviteTokenFrom(html) {
  return /\/invite\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? null;
}

const EJS_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => EJS_ENTITIES[c]);
}

export function decodeEntities(html) {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#34;', '"')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}
