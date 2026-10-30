import { MS_PER_DAY } from '../../lib/time.js';
import { GALLERY_DETAIL_LABELS, galleryTitle } from '../../domain/gallery.js';
import { createActivityRepository } from '../../db/activity.repository.js';
import { createActivityService } from '../../services/activity.service.js';
import { plural } from '../../lib/plural.js';

const MINUTE = 60 * 1000;

const BROWSERS = Object.freeze([
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
]);



export const demoVisitor = (index) => ({
  ip: `203.0.113.${10 + (index % 40)}`,
  userAgent: BROWSERS[(index + 1) % BROWSERS.length],
});


function accountEvents({ at, from }, admin, people) {
  people.forEach(({ user, joinedDaysAgo }, index) => {
    at(joinedDaysAgo + 1, 30, { kind: 'inviteCreated', actor: admin, details: `For ${user.display_name}` });
    at(joinedDaysAgo, 60, { kind: 'inviteUsed', actor: user, details: user.email });
    at(joinedDaysAgo, 61, { kind: 'signedIn', actor: user, ...from(index) });
  });
}

function detailsSet(spec) {
  const fields = [
    spec.title && GALLERY_DETAIL_LABELS.title,
    spec.description && GALLERY_DETAIL_LABELS.description,
    spec.allowZip && GALLERY_DETAIL_LABELS.allowZip,
    spec.gridText !== undefined && GALLERY_DETAIL_LABELS.gridText,
  ].filter(Boolean);
  const texts = spec.texts.length;
  return (texts ? [...fields, plural(texts, 'image text')] : fields).join(', ');
}

const MAX_STORY_VISITS = 12;

const ZIP_EVERY_NTH_VISIT = 4;

function shareEvents({ at }, { owner, spec }, gallery) {
  const sharedDay = spec.createdDaysAgo - 1;
  at(sharedDay, 200, { kind: 'linkShared', actor: owner, gallery });
  const visits = Math.min(spec.shared.views, MAX_STORY_VISITS);
  for (let v = 0; v < visits; v++) {
    const visitDay = sharedDay - (v * sharedDay) / visits;
    const visitor = demoVisitor(v);
    at(visitDay, 300 + v * 7, { kind: 'galleryVisited', actor: 'visitor', subject: owner, gallery, ...visitor });
    if (spec.allowZip && v % ZIP_EVERY_NTH_VISIT === 1) {
      at(visitDay, 303 + v * 7, { kind: 'zipDownloaded', actor: 'visitor', subject: owner, gallery, ...visitor });
    }
  }
}

function galleryEvents(story, seeded, ownerIndex) {
  const { at, from } = story;
  const { id, owner, spec } = seeded;
  const gallery = { id, title: galleryTitle(spec) };
  const untitled = { id, title: galleryTitle(null) };
  const day = spec.createdDaysAgo;
  at(day, 120, { kind: 'galleryCreated', actor: owner, gallery: untitled });
  at(day, 125, { kind: 'imagesAdded', actor: owner, gallery: untitled, details: `${spec.images} added` });
  const details = detailsSet(spec);
  if (details) at(day, 140, { kind: 'galleryDetailsChanged', actor: owner, gallery, details });
  if (spec.images > 1) at(day, 150, { kind: 'imagesReordered', actor: owner, gallery });
  if (spec.shared) shareEvents(story, seeded, gallery);
  if (spec.trashed) at(Math.max(day - 5, 1), 400, { kind: 'galleryTrashed', actor: owner, gallery });
  if (ownerIndex >= 0 && day > 1) at(day - 1, 500, { kind: 'signedIn', actor: owner, ...from(ownerIndex) });
}

function adminEvents({ at, from }, admin, people, galleries) {
  const shared = galleries.find((g) => g.spec.shared);
  if (shared) {
    at(6, 600, {
      kind: 'galleryDetailsChanged',
      actor: admin,
      subject: shared.owner,
      gallery: { id: shared.id, title: galleryTitle(shared.spec) },
      details: GALLERY_DETAIL_LABELS.description,
    });
  }
  const second = people[1];
  if (second) {
    at(11, 700, { kind: 'resetLinkIssued', actor: admin, subject: second.user });
    at(11, 760, { kind: 'passwordResetDone', actor: second.user });
    at(11, 761, { kind: 'signedIn', actor: second.user, ...from(1) });
  }
}

function securityEvents({ at }, target) {
  const guesser = { ip: '203.0.113.200', userAgent: BROWSERS[2] };
  for (let i = 0; i < 3; i++) at(8, 800 + i, { kind: 'signInFailed', actor: 'visitor', details: target, ...guesser });
  at(8, 804, { kind: 'rateLimitHit', actor: 'visitor', details: 'sign-in form', ...guesser });
}

export function demoActivity({
  admin,
  people,
  galleries,
  inviteLabel,
  switchTitles = [],
  serverUrl = 'http://localhost:3000',
  now = Date.now(),
}) {
  const events = [];
  const story = {
    at: (days, minutes, event) => events.push({ at: now - days * MS_PER_DAY + minutes * MINUTE, event }),
    from: (index) => ({ ip: `198.51.100.${20 + index}`, userAgent: BROWSERS[index % BROWSERS.length] }),
    adminFrom: { ip: '192.0.2.10', userAgent: BROWSERS[0] },
  };
  const { at, adminFrom } = story;

  at(45, 0, { kind: 'serverStarted', actor: 'system', details: serverUrl });
  at(45, 5, { kind: 'signedIn', actor: admin, ...adminFrom });
  accountEvents(story, admin, people);
  for (const seeded of galleries) {
    galleryEvents(
      story,
      seeded,
      people.findIndex((person) => person.user.id === seeded.owner.id),
    );
  }
  adminEvents(story, admin, people, galleries);
  securityEvents(story, people[0]?.user.email ?? 'someone@example.com');
  if (switchTitles[0]) {
    at(16, 900, { kind: 'settingChanged', actor: admin, details: `${switchTitles[0]}: off → on` });
    at(16, 960, { kind: 'settingChanged', actor: admin, details: `${switchTitles[0]}: on → off` });
  }
  at(7, 1000, { kind: 'serverStopped', actor: 'system' });
  at(7, 1002, { kind: 'serverStarted', actor: 'system', details: serverUrl });
  at(1, 30, { kind: 'signedIn', actor: admin, ...adminFrom });
  at(1, 40, { kind: 'inviteCreated', actor: admin, details: inviteLabel });

  return events.filter((e) => e.at < now).sort((a, b) => a.at - b.at);
}

export function writeDemoActivity(db, { users, galleries }, events) {
  let current = new Date();
  const clock = () => current;
  const activityService = createActivityService({
    activity: createActivityRepository(db, { now: clock }),
    users,
    galleries,
  });
  for (const { at, event } of events) {
    current = new Date(at);
    activityService.record(event);
  }
  return events.length;
}
