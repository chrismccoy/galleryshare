import { GALLERY_THEME } from './config/gallery-theme.js';
import { SHARE_THEMES } from './domain/share-themes.js';

export const SHARE_THEME_CLASSES = SHARE_THEMES.map((theme) => `share-theme-${theme.key}`);

export default {
  content: { relative: true, files: ['./views/**/*.ejs', './public/js/**/*.js'] },
  safelist: SHARE_THEME_CLASSES,
  theme: {
    extend: {
      screens: { '3xl': '1600px' },
      fontSize: { meta: '11.5px', ui: '13px' },
      spacing: { 4.5: '18px', sidebar: '244px' },
      maxWidth: { ...GALLERY_THEME.maxWidth, public: '1120px', share: '920px' },
      colors: { ...GALLERY_THEME.colors },
      borderRadius: { ...GALLERY_THEME.borderRadius },
      boxShadow: { ...GALLERY_THEME.boxShadow },
    },
  },
};
