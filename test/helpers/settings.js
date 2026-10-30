import { SETTING_KEYS } from '../../domain/settings.js';
import { FOLLOW_SITE } from '../../domain/gallery-choice.js';

export function withSettings(t, context, values = {}) {
  const saved = Object.values(SETTING_KEYS).map((key) => [key, context.settings.get(key)]);
  t.after(() => {
    for (const [key, value] of saved) context.settings.set(key, value);
  });
  const set = (more) => {
    for (const [name, value] of Object.entries(more)) {
      if (!Object.hasOwn(SETTING_KEYS, name)) throw new Error(`withSettings: unknown setting "${name}"`);
      context.settings.set(SETTING_KEYS[name], value);
    }
  };
  set(values);
  return set;
}

export function setGalleryChoices(context, user, galleryId, { shareTheme, imageView, gridText }) {
  const meta = {};
  if (shareTheme !== undefined) meta.shareTheme = shareTheme ?? FOLLOW_SITE;
  if (imageView !== undefined) meta.imageView = imageView ?? FOLLOW_SITE;
  if (gridText !== undefined) meta.gridText = gridText === null ? FOLLOW_SITE : gridText ? 'show' : 'hide';
  return context.galleriesService.saveEdits(user, galleryId, { meta, images: [] });
}
