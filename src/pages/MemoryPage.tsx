import { useId, useMemo, useState, type FormEvent } from 'react';
import { Brain, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { Dialog, ConfirmDialog } from '../components/Dialog';
import { MicButton } from '../components/MicButton';
import { useServices } from '../services/ServicesContext';
import { useCollection } from '../hooks/useCollection';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { ValidationError } from '../services/storage/localCollection';
import { matchesQuery } from '../services/memory/localMemoryProvider';
import type { Memory } from '../types/memory';
import { LIMITS } from '../utils/validation';
import { formatDateTime } from '../utils/format';

const errorMessage = (error: unknown) =>
  error instanceof ValidationError ? error.message : 'Could not save on this device. Storage may be full or blocked.';

export default function MemoryPage() {
  const { memory } = useServices();
  const { items, loading, loadError, create, update, remove } = useCollection(memory);
  const { announce } = useAnnouncer();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  const filtered = useMemo(() => (query.trim() ? items.filter((m) => matchesQuery(m.text, query)) : items), [items, query]);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      announce('Memory deleted.');
    } catch {
      announce('Could not delete the memory.', 'assertive');
    }
    setDeleting(null);
  };

  return (
    <>
      <PageHeader
        title="Memory"
        icon={<Brain className="h-7 w-7" />}
        description="Save things you want OpenEyes to remember, like where you keep your keys."
      />

      <button type="button" className="btn-primary w-full text-lg" onClick={() => setAdding(true)}>
        <Plus aria-hidden="true" className="h-6 w-6" /> Add a memory
      </button>
      <p className="mt-3 text-sm text-muted">
        Memories are saved only in this browser on this device. They are not synced or backed up. Avoid saving passwords,
        bank or medical details.
      </p>

      <div className="mt-6">
        <label htmlFor={searchId} className="label">
          Search memories
        </label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field pl-12 text-lg"
            placeholder="For example, keys"
          />
        </div>
      </div>

      <section aria-labelledby="memories-heading" className="mt-6">
        <h2 id="memories-heading" className="text-xl font-bold">
          Saved memories
        </h2>
        <p className="mt-1 text-muted" role="status">
          {loading
            ? 'Loading memories'
            : query.trim()
              ? `${filtered.length} of ${items.length} ${items.length === 1 ? 'memory' : 'memories'} match`
              : `${items.length} ${items.length === 1 ? 'memory' : 'memories'} saved`}
        </p>
        {loadError && (
          <div className="mt-3">
            <Notice variant="error">{loadError}</Notice>
          </div>
        )}
        {!loading && items.length === 0 && <p className="mt-4 text-lg text-muted">You have not saved any memories yet.</p>}
        <ul className="mt-4 space-y-3">
          {filtered.map((m) => (
            <li key={m.id} className="card p-4 animate-fade-up">
              <p className="whitespace-pre-wrap break-words text-lg">{m.text}</p>
              <p className="mt-2 text-sm text-muted">Updated {formatDateTime(m.updatedAt)}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(m)} aria-label={`Edit memory: ${m.text}`}>
                  <Pencil aria-hidden="true" className="h-5 w-5" /> Edit
                </button>
                <button type="button" className="btn-danger flex-1" onClick={() => setDeleting(m)} aria-label={`Delete memory: ${m.text}`}>
                  <Trash2 aria-hidden="true" className="h-5 w-5" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <MemoryEditor
        open={adding}
        title="Add a memory"
        submitLabel="Save memory"
        onClose={() => setAdding(false)}
        onSubmit={async (text) => {
          await create({ text });
          announce('Memory saved on this device.');
        }}
      />
      <MemoryEditor
        key={editing?.id}
        open={Boolean(editing)}
        title="Edit memory"
        submitLabel="Save changes"
        initialText={editing?.text}
        onClose={() => setEditing(null)}
        onSubmit={async (text) => {
          if (!editing) return;
          await update(editing.id, { text });
          announce('Memory updated.');
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this memory?"
        message={<>&ldquo;{deleting?.text}&rdquo; will be permanently removed from this device.</>}
        confirmLabel="Delete memory"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

interface MemoryEditorProps {
  open: boolean;
  title: string;
  submitLabel: string;
  initialText?: string;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

function MemoryEditor({ open, title, submitLabel, initialText = '', onClose, onSubmit }: MemoryEditorProps) {
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const speech = useSpeechRecognition({
    onFinal: (heard) => setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard).slice(0, LIMITS.memoryText)),
  });

  const close = () => {
    speech.stop();
    setText(initialText);
    setError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(text);
      setText(initialText);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} title={title} onClose={close}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={fieldId} className="label">
          Memory
        </label>
        <textarea
          id={fieldId}
          data-autofocus
          rows={4}
          value={text}
          maxLength={LIMITS.memoryText}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ''}`}
          className="field text-lg"
          placeholder="I keep my keys on the table near the entrance."
        />
        <p id={`${fieldId}-hint`} className="mt-2 text-sm text-muted">
          {text.length} of {LIMITS.memoryText} characters. Nothing is saved until you press {submitLabel}.
        </p>
        {speech.supported && (
          <div className="mt-3 flex items-center gap-3">
            <MicButton size="md" listening={speech.listening} onStart={speech.start} onStop={speech.stop} idleLabel="Dictate memory" />
            <span className="text-muted" aria-hidden="true">
              {speech.listening ? 'Listening...' : 'Dictate'}
            </span>
          </div>
        )}
        {speech.error && <p className="mt-2 font-bold text-danger">{SPEECH_ERROR_MESSAGES[speech.error]}</p>}
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="mt-2 font-bold text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
