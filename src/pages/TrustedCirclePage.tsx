import { useId, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Mail, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { useServices } from '../services/ServicesContext';
import { useCollection } from '../hooks/useCollection';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { ValidationError } from '../services/storage/localCollection';
import type { TrustedContact, TrustedContactInput } from '../types/memory';
import { LIMITS, toDialable } from '../utils/validation';

const EMPTY: TrustedContactInput = { name: '', relationship: '', phone: '', email: '' };

type PendingContact = { contact: TrustedContact; method: 'call' | 'email' };
type FieldProps = InputHTMLAttributes<HTMLInputElement> & { 'data-autofocus'?: boolean };

export default function TrustedCirclePage() {
  const { contacts } = useServices();
  const { items, loading, loadError, create, update, remove } = useCollection(contacts);
  const { announce } = useAnnouncer();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TrustedContact | null>(null);
  const [removing, setRemoving] = useState<TrustedContact | null>(null);
  const [reaching, setReaching] = useState<PendingContact | null>(null);

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove(removing.id);
      announce(`${removing.name} removed from your Trusted Circle.`);
    } catch {
      announce('Could not remove the contact.', 'assertive');
    }
    setRemoving(null);
  };

  const confirmReach = () => {
    if (!reaching) return;
    const { contact, method } = reaching;
    const href = method === 'call' ? `tel:${toDialable(contact.phone)}` : `mailto:${encodeURIComponent(contact.email)}`;
    setReaching(null);
    window.location.href = href;
  };

  return (
    <>
      <PageHeader
        title="Trusted Circle"
        icon={<Users className="h-7 w-7" />}
        description="Keep the people you trust close at hand."
      />

      <Notice variant="info" title="Important">
        OpenEyes never calls or messages anyone on its own, and it is not connected to emergency services. For an emergency,
        call your local emergency number directly.
      </Notice>

      <button type="button" className="btn-primary mt-4 w-full text-lg" onClick={() => setAdding(true)}>
        <Plus aria-hidden="true" className="h-6 w-6" /> Add a contact
      </button>

      <section aria-labelledby="contacts-heading" className="mt-6">
        <h2 id="contacts-heading" className="text-xl font-bold">
          Your contacts
        </h2>
        <p className="mt-1 text-muted" role="status">
          {loading ? 'Loading contacts' : `${items.length} ${items.length === 1 ? 'contact' : 'contacts'}. Saved on this device only.`}
        </p>
        {loadError && (
          <div className="mt-3">
            <Notice variant="error">{loadError}</Notice>
          </div>
        )}
        <ul className="mt-4 space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card p-4 animate-fade-up">
              <h3 className="text-xl font-bold">{c.name}</h3>
              {c.relationship && <p className="text-muted">{c.relationship}</p>}
              <dl className="mt-2 space-y-1">
                {c.phone && (
                  <div className="flex gap-2">
                    <dt className="font-bold">Phone:</dt>
                    <dd className="break-all">{c.phone}</dd>
                  </div>
                )}
                {c.email && (
                  <div className="flex gap-2">
                    <dt className="font-bold">Email:</dt>
                    <dd className="break-all">{c.email}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {c.phone && (
                  <button type="button" className="btn-secondary" onClick={() => setReaching({ contact: c, method: 'call' })} aria-label={`Call ${c.name}`}>
                    <Phone aria-hidden="true" className="h-5 w-5" /> Call
                  </button>
                )}
                {c.email && (
                  <button type="button" className="btn-secondary" onClick={() => setReaching({ contact: c, method: 'email' })} aria-label={`Email ${c.name}`}>
                    <Mail aria-hidden="true" className="h-5 w-5" /> Email
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                  <Pencil aria-hidden="true" className="h-5 w-5" /> Edit
                </button>
                <button type="button" className="btn-danger" onClick={() => setRemoving(c)} aria-label={`Remove ${c.name}`}>
                  <Trash2 aria-hidden="true" className="h-5 w-5" /> Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ContactEditor
        open={adding}
        title="Add a contact"
        onClose={() => setAdding(false)}
        onSubmit={async (input) => {
          await create(input);
          announce(`${input.name} added to your Trusted Circle.`);
        }}
      />
      <ContactEditor
        key={editing?.id}
        open={Boolean(editing)}
        title="Edit contact"
        initial={editing ?? EMPTY}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (!editing) return;
          await update(editing.id, input);
          announce('Contact updated.');
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? 'contact'}?`}
        message="They will be removed from your Trusted Circle on this device."
        confirmLabel="Remove contact"
        destructive
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={Boolean(reaching)}
        title={reaching?.method === 'call' ? `Call ${reaching.contact.name}?` : `Email ${reaching?.contact.name ?? ''}?`}
        message={
          reaching?.method === 'call'
            ? `This opens your phone app with ${reaching.contact.phone}. The call starts only when you confirm it there.`
            : `This opens your email app addressed to ${reaching?.contact.email ?? ''}. Nothing is sent until you send it there.`
        }
        confirmLabel={reaching?.method === 'call' ? 'Open phone app' : 'Open email app'}
        onConfirm={confirmReach}
        onCancel={() => setReaching(null)}
      />
    </>
  );
}

interface ContactEditorProps {
  open: boolean;
  title: string;
  initial?: TrustedContactInput;
  onClose: () => void;
  onSubmit: (input: TrustedContactInput) => Promise<void>;
}

function ContactEditor({ open, title, initial = EMPTY, onClose, onSubmit }: ContactEditorProps) {
  const id = useId();
  const start = { name: initial.name, relationship: initial.relationship, phone: initial.phone, email: initial.email };
  const [form, setForm] = useState<TrustedContactInput>(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setForm(start);
    setError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      setForm(start);
      onClose();
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : 'Could not save on this device.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof TrustedContactInput, label: string, props: FieldProps) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="label">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="field text-lg"
        {...props}
      />
    </div>
  );

  return (
    <Dialog open={open} title={title} onClose={close}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {field('name', 'Name (required)', { autoComplete: 'name', maxLength: LIMITS.contactName, 'data-autofocus': true })}
        {field('relationship', 'Relationship (optional)', { maxLength: LIMITS.contactRelationship, placeholder: 'For example, sister' })}
        {field('phone', 'Phone number', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', maxLength: 24 })}
        {field('email', 'Email address', { type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: LIMITS.contactEmail })}
        <p className="text-sm text-muted">Add at least a phone number or an email address.</p>
        {error && (
          <p role="alert" className="font-bold text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            Save contact
          </button>
        </div>
      </form>
    </Dialog>
  );
}
