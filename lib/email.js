export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email) =>
  String(email ?? '')
    .trim()
    .toLowerCase();
