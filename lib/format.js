import { MS_PER_DAY } from './time.js';
import { BYTES_PER_GB, BYTES_PER_KB, BYTES_PER_MB } from './size.js';

export const DELETED_USER = 'Deleted user';

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtc(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatUtcDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

export function purgeDate(trashedAt, retentionDays) {
  const date = toDate(trashedAt);
  return date ? formatUtcDate(date.getTime() + retentionDays * MS_PER_DAY) : '';
}

export const pct = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < BYTES_PER_KB) return `${n} B`;
  if (n < BYTES_PER_MB) return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  if (n < BYTES_PER_GB) return `${(n / BYTES_PER_MB).toFixed(1)} MB`;
  return `${(n / BYTES_PER_GB).toFixed(1)} GB`;
}
