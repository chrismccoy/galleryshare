import { BRAND_PALETTE } from './brand.js';

export const GALLERY_THEME = Object.freeze({
  colors: Object.freeze({
    brand: BRAND_PALETTE,
    accent: '#0071e3',
    muted: '#6e6e73',
  }),
  borderRadius: Object.freeze({
    pill: '100px',
  }),
  maxWidth: Object.freeze({
    lightbox: '1000px',
  }),
  boxShadow: Object.freeze({
    'bento-sm': '0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)',
    'bento-md': '0 4px 16px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.07)',
  }),
});
