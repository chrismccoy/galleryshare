
export function systemNow() {
  return new Date();
}

export const MS_PER_SECOND = 1000;

export const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND;

export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function toIso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function nowIso(now = systemNow) {
  return toIso(now());
}

export function isoAfter(date, ms) {
  return toIso(date.getTime() + ms);
}
