import { GALLERY_THEME } from './config/gallery-theme.js';

export default {
  content: { relative: true, files: ['./public/screenshots/index.html', './public/js/lightbox.js'] },
  theme: {
    extend: {
      colors: {
        ...GALLERY_THEME.colors,
        bg: '#f5f5f7',
        text: '#1d1d1f',
      },
      borderRadius: { ...GALLERY_THEME.borderRadius },
      maxWidth: { ...GALLERY_THEME.maxWidth },
      boxShadow: { ...GALLERY_THEME.boxShadow },
    },
  },
};
