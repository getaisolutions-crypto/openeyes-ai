export const LIMITS = {
  memoryText: 1000,
  chatMessage: 2000,
  objectQuery: 80,
  contactName: 80,
  contactRelationship: 60,
  contactEmail: 254,
  readText: 20000,
} as const;

/** Collapses whitespace and strips control characters. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export type ValidationResult = { ok: true; value: string } | { ok: false; error: string };

export function validateRequiredText(raw: string, label: string, max: number): ValidationResult {
  const value = cleanText(raw);
  if (!value) return { ok: false, error: `${label} cannot be empty.` };
  if (value.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value };
}

const PHONE_PATTERN = /^\+?[0-9 ()\-.]{5,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validatePhone(raw: string): ValidationResult {
  const value = cleanText(raw);
  if (!value) return { ok: true, value: '' };
  if (!PHONE_PATTERN.test(value) || value.replace(/\D/g, '').length < 5) {
    return { ok: false, error: 'Enter a valid phone number using digits, spaces, dashes or a leading plus sign.' };
  }
  return { ok: true, value };
}

export function validateEmail(raw: string): ValidationResult {
  const value = cleanText(raw);
  if (!value) return { ok: true, value: '' };
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return { ok: false, error: 'Enter a valid email address, for example name@example.com.' };
  }
  return { ok: true, value };
}

/** Digits and a leading plus only, safe for tel: links. */
export function toDialable(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}
