import type { ContactsProvider, TrustedContact, TrustedContactInput } from '../../types/memory';
import { STORAGE_KEYS } from '../../utils/storage';
import { LIMITS, cleanText, validateEmail, validatePhone, validateRequiredText } from '../../utils/validation';
import { ValidationError, createLocalCollection, hasBaseFields } from '../storage/localCollection';

function normalizeContact(input: TrustedContactInput): TrustedContactInput {
  const name = validateRequiredText(input.name, 'Name', LIMITS.contactName);
  if (!name.ok) throw new ValidationError(name.error);
  const phone = validatePhone(input.phone);
  if (!phone.ok) throw new ValidationError(phone.error);
  const email = validateEmail(input.email);
  if (!email.ok) throw new ValidationError(email.error);
  if (!phone.value && !email.value) {
    throw new ValidationError('Add a phone number or an email address so you can reach this person.');
  }
  const relationship = cleanText(input.relationship).slice(0, LIMITS.contactRelationship);
  return { name: name.value, relationship, phone: phone.value, email: email.value };
}

function isContact(value: unknown): value is TrustedContact {
  return (
    hasBaseFields(value) &&
    typeof value.name === 'string' &&
    typeof value.relationship === 'string' &&
    typeof value.phone === 'string' &&
    typeof value.email === 'string'
  );
}

export function createLocalContactsProvider(storageKey: string = STORAGE_KEYS.contacts): ContactsProvider {
  return createLocalCollection<TrustedContact, TrustedContactInput>({
    storageKey,
    normalize: normalizeContact,
    isValid: isContact,
  });
}
