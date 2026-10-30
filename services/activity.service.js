import { EVENTS, MAX_ACTIVITY_TEXT, browserName } from '../domain/activity.js';
import { NOOP_LOGGER, errorFields } from '../lib/logger.js';
import { DEFAULT_GALLERY_TITLE, galleryTitle } from '../domain/gallery.js';


const NO_GALLERIES = Object.freeze({
  byIdIncludingTrashed: () => null,
});

const sortBy = (options, field) =>
  options.sort((a, b) => a[field].localeCompare(b[field], undefined, { sensitivity: 'base' }));




const clip = (value) => (value == null ? null : String(value).slice(0, MAX_ACTIVITY_TEXT));

const oneLine = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();


export const NOOP_ACTIVITY = Object.freeze({
  record: () => {},
});

const NON_USER_ACTORS = Object.freeze({ visitor: 'Visitor', system: 'System' });

const displayName = (row) => row.display_name?.trim() || (row.email ?? null);

export function createActivityService({
  activity,
  users,
  galleries = NO_GALLERIES,
  logger = NOOP_LOGGER,
  afterCommit = (callback) => callback(),
}) {
  const resolveUser = (ref) => {
    if (ref == null) return { id: null, name: null, email: null };
    const row = typeof ref === 'object' ? ref : users.byId(ref);
    if (!row) return { id: ref, name: null, email: null };
    const email = row.email ?? null;
    return { id: row.id, name: displayName(row), email };
  };

  const summarize = ({ galleryTitle, details, actorName, subjectName, ip }) => {
    let text = galleryTitle ? `"${galleryTitle}"` : '';
    if (details) text += text ? `: ${details}` : details;
    if (actorName) text += `${text ? ' ' : ''}by ${actorName}`;
    if (subjectName && subjectName !== actorName) text += `${text ? ' ' : ''}for ${subjectName}`;
    if (ip) text += `${text ? ' ' : ''}from ${ip}`;
    return oneLine(text);
  };

  const personOption = ({ id, name }) => {
    const row = users.byId(id);
    if (row) return { id, name: displayName(row) };
    return { id, name: `${name ?? `User #${id}`} (deleted)` };
  };

  const galleryOptions = (values) =>
    sortBy(
      values.map(({ id, title }) => {
        const row = galleries.byIdIncludingTrashed(id);
        if (!row) return { id, title: `${title ?? DEFAULT_GALLERY_TITLE} (deleted)` };
        return { id, title: row.deleted_at ? `${galleryTitle(row)} (in Trash)` : galleryTitle(row) };
      }),
      'title',
    );

  const toView = (row, who, withFrom) => ({
    id: row.id,
    when: row.at,
    who: who(row),
    area: row.area,
    kind: row.kind,
    what: EVENTS[row.kind]?.label ?? row.kind,
    details: row.details,
    from: withFrom ? [row.ip, browserName(row.user_agent)].filter(Boolean).join(' · ') || null : null,
    galleryId: row.gallery_id,
    galleryTitle: row.gallery_title,
  });

  return {
    record({ kind, actor: given, subject = null, gallery = null, details = null, ip = null, userAgent = null }) {
      const actor = given ?? 'system';
      const event = EVENTS[kind];
      if (!event) throw new Error(`Unknown activity kind: ${kind}`);
      try {
        const actorType = actor === 'visitor' || actor === 'system' ? actor : 'user';
        const who = actorType === 'user' ? resolveUser(actor) : { id: null, name: null, email: null };
        const concerned = resolveUser(subject);
        const row = {
          area: event.area,
          kind,
          actorType,
          actorId: who.id,
          actorName: who.name,
          subjectUserId: concerned.id,
          subjectName: concerned.name,
          galleryId: gallery?.id ?? null,
          galleryTitle: clip(gallery?.title),
          details: clip(details),
          ip: clip(ip),
          userAgent: clip(userAgent),
        };
        const log = () =>
          logger.info(event.label, {
            summary: summarize({
              ...row,
              actorName: who.email ?? who.name,
              subjectName: concerned.email ?? concerned.name,
            }),
            area: event.area,
            kind,
            galleryId: row.galleryId,
            actorId: row.actorId,
            subjectUserId: row.subjectUserId,
          });
        activity.insert(row);
        afterCommit(log);
      } catch (error) {
        logger.warn('activity not recorded', { kind, ...errorFields(error) });
      }
    },

    listForAdmin(filter = {}) {
      return activity
        .list({ ...filter, viewerId: null })
        .map((row) => toView(row, (r) => NON_USER_ACTORS[r.actor_type] ?? r.actor_name ?? `User #${r.actor_id}`, true));
    },

    listForUser(user, filter = {}) {
      return activity
        .list({ ...filter, viewerId: user.id })
        .map((row) =>
          toView(row, (r) => NON_USER_ACTORS[r.actor_type] ?? (r.actor_id === user.id ? 'You' : 'An admin'), false),
        );
    },

    purgeBefore(cutoffIso) {
      return activity.purgeBefore(cutoffIso);
    },

    countForAdmin: () => activity.count(),

    countForUser: (user) => activity.count({ viewerId: user.id }),

    filterOptionsForAdmin() {
      const values = activity.filterValues();
      return { people: sortBy(values.people.map(personOption), 'name'), galleries: galleryOptions(values.galleries) };
    },

    filterOptionsForUser(user) {
      return { people: [], galleries: galleryOptions(activity.filterValues({ viewerId: user.id }).galleries) };
    },
  };
}
