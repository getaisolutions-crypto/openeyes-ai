import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../Dialog';
import { MicButton } from '../MicButton';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { ValidationError } from '../../services/storage/localCollection';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, type MemoryCategory, type MemoryInput } from '../../types/memory';
import { LIMITS } from '../../utils/validation';

const errorMessage = (error: unknown) =>
  error instanceof ValidationError ? error.message : 'Could not save on this device. Storage may be full or blocked.';

function toDateField(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateField(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 9, 0, 0, 0).toISOString();
}

interface Props {
  open: boolean;
  title: string;
  submitLabel: string;
  initialText?: string;
  initialCategory?: MemoryCategory;
  initialDueAt?: string;
  onClose: () => void;
  onSubmit: (input: MemoryInput) => Promise<void>;
}

export function MemoryEditor({
  open,
  title,
  submitLabel,
  initialText = '',
  initialCategory = 'note',
  initialDueAt,
  onClose,
  onSubmit,
}: Props) {
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [category, setCategory] = useState<MemoryCategory>(initialCategory);
  const [due, setDue] = useState(toDateField(initialDueAt));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const speech = useSpeechRecognition({
    onFinal: (heard) => setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard).slice(0, LIMITS.memoryText)),
  });

  const reset = () => {
    setText(initialText);
    setCategory(initialCategory);
    setDue(toDateField(initialDueAt));
    setError(null);
  };

  const close = () => {
    speech.stop();
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: MemoryInput = { text, category };
      if (category === 'reminder') input.dueAt = fromDateField(due);
      await onSubmit(input);
      reset();
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

        <label htmlFor={`${fieldId}-category`} className="label mt-4">
          Type of memory
        </label>
        <select
          id={`${fieldId}-category`}
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          className="field text-lg"
        >
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {MEMORY_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        {category === 'reminder' && (
          <>
            <label htmlFor={`${fieldId}-due`} className="label mt-4">
              Due date (optional)
            </label>
            <input
              id={`${fieldId}-due`}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-describedby={`${fieldId}-due-hint`}
              className="field text-lg"
            />
            <p id={`${fieldId}-due-hint`} className="mt-2 text-sm text-muted">
              OpenEyes does not send alerts. Check your reminders here.
            </p>
          </>
        )}

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
