import { formatUtc } from '../../lib/format.js';
import { positiveInt } from '../../lib/params.js';
import { listPage } from './list-page.js';
import { noStore, renderInShell } from './respond.js';

export const RECENT_ACTIVITY = 5;

export const KIND_TONES = Object.freeze({
  galleryCreated: 'green',
  imagesAdded: 'green',
  galleryRestored: 'green',
  linkShared: 'green',
  inviteCreated: 'green',
  inviteUsed: 'green',
  userEnabled: 'green',
  signedIn: 'green',
  serverStarted: 'green',
  galleryDetailsChanged: 'amber',
  imagesReordered: 'amber',
  settingChanged: 'amber',
  publicSharingChanged: 'amber',
  userRoleChanged: 'amber',
  passwordChanged: 'amber',
  resetLinkIssued: 'amber',
  passwordResetDone: 'amber',
  galleryTrashed: 'red',
  galleryDeleted: 'red',
  trashEmptied: 'red',
  imageRemoved: 'red',
  linkRevoked: 'red',
  inviteRevoked: 'red',
  userDisabled: 'red',
  userDeleted: 'red',
  signInFailed: 'red',
  rateLimitHit: 'red',
  galleryVisited: 'sky',
  zipDownloaded: 'sky',
});
const detailsText = ({ galleryTitle: title, details }) => {
  const gallery = title ? `\u201c${title}\u201d` : '';
  return [gallery, details].filter(Boolean).join(': ');
};

const areaLabel = (area) => area.charAt(0).toUpperCase() + area.slice(1);

export const toActivityRow = (row) => ({
  when: formatUtc(row.when),
  who: row.who,
  area: { text: areaLabel(row.area), tone: KIND_TONES[row.kind] ?? 'neutral' },
  what: row.what,
  details: detailsText(row),
  from: row.from ?? '',
});

const offeredOptionId = (value, options) => {
  const id = positiveInt(value);
  return options.some((option) => option.id === id) ? id : null;
};

export function renderActivityPage(
  req,
  res,
  { title, path, admin, areas, retentionDays, pageSize, people, galleries, list },
) {
  const area = areas.includes(req.query.area) ? req.query.area : null;
  const personId = offeredOptionId(req.query.person_id, admin ? people : []);
  const galleryId = offeredOptionId(req.query.gallery_id, galleries);
  const { rows, olderUrl } = listPage(req, {
    pageSize,
    path,
    params: { person_id: personId, area, gallery_id: galleryId },
    fetch: ({ beforeId, limit }) => list({ beforeId, limit, personId, area, galleryId }),
  });
  noStore(res);
  return renderInShell(res, 'pages/activity', {
    title,
    admin,
    path,
    rows: rows.map(toActivityRow),
    filters: { personId, area, galleryId },
    people,
    areaOptions: areas.map((key) => ({ key, label: areaLabel(key) })),
    galleries,
    retentionDays,
    olderUrl,
  });
}
