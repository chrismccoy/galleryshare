import { createKeyedChoice } from './gallery-choice.js';

export const SHARE_THEMES = Object.freeze([
  Object.freeze({ key: 'none', label: 'None' }),
  Object.freeze({ key: 'frame', label: 'Frame' }),
  Object.freeze({ key: 'dark-wall', label: 'Dark wall' }),
  Object.freeze({ key: 'app-window', label: 'App window' }),
  Object.freeze({ key: 'polaroid', label: 'Polaroid' }),
  Object.freeze({ key: 'glass', label: 'Glass' }),
  Object.freeze({ key: 'paper-stack', label: 'Paper stack' }),
]);

export const DEFAULT_SHARE_THEME = 'none';

export const SHARE_THEME_MESSAGE = `Choose a share theme: ${SHARE_THEMES.map((theme) => theme.key).join(', ')}.`;

const OWN_PARTIAL_THEMES = Object.freeze(['none', 'app-window']);

export const shareThemePartial = (key) => (OWN_PARTIAL_THEMES.includes(key) ? key : 'panel');

export const SHARE_THEME_CHOICE = createKeyedChoice({
  options: SHARE_THEMES,
  defaultKey: DEFAULT_SHARE_THEME,
  column: 'share_theme',
  message: SHARE_THEME_MESSAGE,
});

export const isShareTheme = SHARE_THEME_CHOICE.is;

export const shareThemeLabel = SHARE_THEME_CHOICE.label;

export const GALLERY_SHARE_THEME_CHOICES = SHARE_THEME_CHOICE.galleryChoices;

export const shareThemeFromChoice = SHARE_THEME_CHOICE.fromChoice;

export const shareThemeChoice = SHARE_THEME_CHOICE.choiceOf;

export const shareThemeFor = SHARE_THEME_CHOICE.resolve;
