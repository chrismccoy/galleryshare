import { deepFreeze } from '../lib/deep-freeze.js';
import { TUNABLES, isTunableValue, storedTunable, tunableMessage } from './limits.js';
import { SHARE_THEME_CHOICE } from './share-themes.js';
import { IMAGE_VIEW_CHOICE } from './image-views.js';

export const SETTING_KEYS = deepFreeze({
  publicSharing: 'public_sharing',
  shareGridText: 'share_grid_text',
  overrideShareGridText: 'override_share_grid_text',
  shareTheme: 'share_theme',
  overrideShareTheme: 'override_share_theme',
  shareImageView: 'share_image_view',
  overrideShareImageView: 'override_share_image_view',
  itemsPerPage: TUNABLES.itemsPerPage.settingKey,
  overrideItemsPerPage: TUNABLES.itemsPerPage.overrideKey,
});

export const ITEMS_PER_PAGE_MESSAGE = tunableMessage('itemsPerPage');

export const isItemsPerPage = (value) => isTunableValue('itemsPerPage', value);

export const storedItemsPerPage = (values) => storedTunable(values, 'itemsPerPage');

const onUnlessSavedOff = (values, key) => values[key] !== false;

export function publicSharingOn(values) {
  return onUnlessSavedOff(values, SETTING_KEYS.publicSharing);
}


export const OVERRIDE_SWITCHES = deepFreeze([
  ...Object.values(TUNABLES).map((def) => ({
    name: def.overrideKey,
    title: `Use custom ${def.label[0].toLowerCase()}${def.label.slice(1)}`,
    help: `Use the number saved below instead of ${def.env} from .env.`,
  })),
  {
    name: SETTING_KEYS.overrideShareGridText,
    title: 'Use custom grid text setting',
    help: 'Use the "Titles and captions on the gallery grid" switch below instead of SHARE_GRID_TEXT from .env.',
  },
  {
    name: SETTING_KEYS.overrideShareTheme,
    title: 'Use custom share theme',
    help: 'Use the "Share theme" chosen below instead of SHARE_THEME from .env.',
  },
  {
    name: SETTING_KEYS.overrideShareImageView,
    title: 'Use custom image view',
    help: 'Use the "Image view" chosen below instead of SHARE_IMAGE_VIEW from .env.',
  },
]);

export function storedShareImageView(values) {
  return IMAGE_VIEW_CHOICE.stored(values[SETTING_KEYS.shareImageView]);
}

export function storedShareTheme(values) {
  return SHARE_THEME_CHOICE.stored(values[SETTING_KEYS.shareTheme]);
}

export function storedShareGridText(values) {
  return onUnlessSavedOff(values, SETTING_KEYS.shareGridText);
}
