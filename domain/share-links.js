import { createHmac } from 'node:crypto';
import { BASE62, newToken } from '../lib/tokens.js';

export const UNAVAILABLE_MESSAGE = "This shared gallery isn't available.";

export const VIEW_RETENTION_DAYS = 90;

export const SHARE_VIEWS_SHOWN = 100;

export const VIEW_USER_AGENT_MAX = 200;

export const VIEW_KINDS = Object.freeze({ page: 'page', zip: 'zip' });

export const TOKEN_LENGTH = 7;

const TOKEN_SHAPE = new RegExp(`^[0-9A-Za-z]{${TOKEN_LENGTH}}$`);

const PREVIEW_BOT_PATTERN = /whatsapp|facebookexternalhit|bot|crawler|spider|preview/i;

export function newNonce() {
  return newToken();
}

export function shareToken(secret, nonce) {
  let n = BigInt('0x' + createHmac('sha256', secret).update(`share:${nonce}`).digest('hex'));
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += BASE62[Number(n % 62n)];
    n /= 62n;
  }
  return out;
}

export function isShareTokenShape(value) {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}

export function isPreviewBot(userAgent) {
  return typeof userAgent === 'string' && PREVIEW_BOT_PATTERN.test(userAgent);
}

export const PAUSE_REASONS = Object.freeze({ trash: 'trash', ownerDisabled: 'owner-disabled' });

export function pauseReason(row) {
  if (row.deleted_at) return PAUSE_REASONS.trash;
  if (row.owner_disabled) return PAUSE_REASONS.ownerDisabled;
  return null;
}
