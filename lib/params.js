import { ValidationError } from './errors.js';

export function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(value) ? n : null;
}

export function noticeFor(map, key) {
  return typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null;
}

export const isBlank = (value) => value === undefined || value === null || value === '';

export function digitsInt(text) {
  return typeof text === 'string' && /^\d+$/.test(text) ? Number(text) : null;
}

export function wholeNumberOrBlank(value, message) {
  const typed = String(value ?? '').trim();
  if (typed === '') return null;
  const number = digitsInt(typed);
  if (number === null) throw new ValidationError(message);
  return number;
}

export function boundedText(value, max, message, { required = false, blankAsNull = false } = {}) {
  const text = String(value ?? '').trim();
  if (text.length > max || (required && text.length < 1)) throw new ValidationError(message);
  return blankAsNull && text === '' ? null : text;
}

export function mergePresent(fields, current, cleaners) {
  return Object.fromEntries(
    Object.entries(cleaners).map(([key, clean]) => [
      key,
      Object.hasOwn(fields, key) ? clean(fields[key]) : current[key],
    ]),
  );
}
