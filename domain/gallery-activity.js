import { galleryTitle } from './gallery.js';

export function galleryEventFields(actor, gallery) {
  const actorId = actor !== null && typeof actor === 'object' ? actor.id : actor;
  return {
    actor,
    subject: gallery.user_id === actorId ? null : gallery.user_id,
    gallery: { id: gallery.id, title: galleryTitle(gallery) },
  };
}
