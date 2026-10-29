import { useId, useMemo, useState } from 'react';
import { Brain, Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { ConfirmDialog } from '../components/Dialog';
import { MemoryEditor } from '../components/memory/MemoryEditor';
import { useServices } from '../services/ServicesContext';
import { useCollection } from '../hooks/useCollection';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { matchesQuery } from '../services/memory/localMemoryProvider';
import { downloadMemoryExport } from '../services/memory/memoryExport';
import { REMINDER_LIMITATION } from '../services/memory/memoryIntent';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, memoryCategory, type Memory, type MemoryCategory } from '../types/memory';
import { formatDateTime } from '../utils/format';

type CategoryFilter = 'all' | MemoryCategory;

function formatDue(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function MemoryPage() {
  const { memory } = useServices();
  const { items, loading, loadError, create, update, remove } = useCollection(memory);
  const { announce } = useAnnouncer();
  const searchId = useId();
  const filterId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      items.filter(
        (m) =>
          (filter === 'all' || memoryCategory(m) === filter) &&
          (!query.trim() || matchesQuery(m.text, query) || matchesQuery(m.subject ?? '', query)),
      ),
    [items, query, filter],
  );
  const hasReminders = items.some((m) => memoryCategory(m) === 'reminder');
  const filtering = Boolean(query.trim()) || filter !== 'all';

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

  const clearAll = async () => {
    setConfirmClearAll(false);
    const ids = items.map((m) => m.id);
    let failed = 0;
    for (const id of ids) {
      try {
        await remove(id);
      } catch {
        failed += 1;
      }
    }
    if (failed) {
      setActionError(`${failed} ${failed === 1 ? 'memory' : 'memories'} could not be deleted. Please try again.`);
      announce('Some memories could not be deleted.', 'assertive');
    } else {
      setActionError(null);
      announce('All memories deleted from this device.');
    }
  };

  const toggleDone = async (m: Memory) => {
    try {
      await update(m.id, { text: m.text, done: !m.done });
      announce(m.done ? 'Reminder marked as not done.' : 'Reminder marked as done.');
    } catch {
      announce('Could not update the reminder.', 'assertive');
    }
  };

  const exportAll = () => {
    try {
      downloadMemoryExport(items);
      announce(`Exported ${items.length} ${items.length === 1 ? 'memory' : 'memories'} as a file.`);
    } catch {
      setActionError('The export could not be created in this browser.');
      announce('The export could not be created.', 'assertive');
    }
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
        bank or medical details. OpenEyes only saves a memory after you confirm it.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
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
        <div>
          <label htmlFor={filterId} className="label">
            Show
          </label>
          <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value as CategoryFilter)} className="field text-lg">
            <option value="all">All memories</option>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasReminders && (
        <div className="mt-4">
          <Notice variant="info" title="About reminders">
            {REMINDER_LIMITATION}
          </Notice>
        </div>
      )}

      <section aria-labelledby="memories-heading" className="mt-6">
        <h2 id="memories-heading" className="text-xl font-bold">
          Saved memories
        </h2>
        <p className="mt-1 text-muted" role="status">
          {loading
            ? 'Loading memories'
            : filtering
              ? `${filtered.length} of ${items.length} ${items.length === 1 ? 'memory' : 'memories'} match`
              : `${items.length} ${items.length === 1 ? 'memory' : 'memories'} saved`}
        </p>
        {loadError && (
          <div className="mt-3">
            <Notice variant="error">{loadError}</Notice>
          </div>
        )}
        {actionError && (
          <div className="mt-3">
            <Notice variant="error">{actionError}</Notice>
          </div>
        )}
        {!loading && items.length === 0 && <p className="mt-4 text-lg text-muted">You have not saved any memories yet.</p>}
        <ul className="mt-4 space-y-3">
          {filtered.map((m) => {
            const category = memoryCategory(m);
            const isReminder = category === 'reminder';
            return (
              <li key={m.id} className="card p-4 animate-fade-up">
                <p className="text-sm font-bold text-primary">{MEMORY_CATEGORY_LABELS[category]}</p>
                <p className={`mt-1 whitespace-pre-wrap break-words text-lg ${isReminder && m.done ? 'line-through opacity-70' : ''}`}>
                  {m.text}
                </p>
                {isReminder && (
                  <p className="mt-1 text-sm">
                    {m.done ? 'Done' : 'Not done'}
                    {m.dueAt && formatDue(m.dueAt) ? ` · Due ${formatDue(m.dueAt)}` : ''}
                  </p>
                )}
                <p className="mt-2 text-sm text-muted">Updated {formatDateTime(m.updatedAt)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {isReminder && (
                    <button
                      type="button"
                      className="btn-secondary flex-1"
                      aria-pressed={Boolean(m.done)}
                      onClick={() => void toggleDone(m)}
                      aria-label={`Mark done: ${m.text}`}
                    >
                      {m.done ? 'Done' : 'Mark done'}
                    </button>
                  )}
                  <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(m)} aria-label={`Edit memory: ${m.text}`}>
                    <Pencil aria-hidden="true" className="h-5 w-5" /> Edit
                  </button>
                  <button type="button" className="btn-danger flex-1" onClick={() => setDeleting(m)} aria-label={`Delete memory: ${m.text}`}>
                    <Trash2 aria-hidden="true" className="h-5 w-5" /> Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {items.length > 0 && (
        <section aria-labelledby="manage-memories-heading" className="mt-8">
          <h2 id="manage-memories-heading" className="text-xl font-bold">
            Manage all memories
          </h2>
          <p className="mt-1 text-sm text-muted">
            The export is a file saved to your device. Anyone who can open it can read your memories.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn-secondary flex-1" onClick={exportAll}>
              <Download aria-hidden="true" className="h-5 w-5" /> Export memories
            </button>
            <button type="button" className="btn-danger flex-1" onClick={() => setConfirmClearAll(true)}>
              <Trash2 aria-hidden="true" className="h-5 w-5" /> Clear all memories
            </button>
          </div>
        </section>
      )}

      <MemoryEditor
        open={adding}
        title="Add a memory"
        submitLabel="Save memory"
        onClose={() => setAdding(false)}
        onSubmit={async (input) => {
          await create(input);
          announce('Memory saved on this device.');
        }}
      />
      <MemoryEditor
        key={editing?.id}
        open={Boolean(editing)}
        title="Edit memory"
        submitLabel="Save changes"
        initialText={editing?.text}
        initialCategory={editing ? memoryCategory(editing) : undefined}
        initialDueAt={editing?.dueAt}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (!editing) return;
          await update(editing.id, input);
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
      <ConfirmDialog
        open={confirmClearAll}
        title="Clear all memories?"
        message={`All ${items.length} saved ${items.length === 1 ? 'memory' : 'memories'}, including item locations and reminders, will be permanently removed from this device. Export them first if you want a copy.`}
        confirmLabel="Delete all memories"
        destructive
        onConfirm={() => void clearAll()}
        onCancel={() => setConfirmClearAll(false)}
      />
    </>
  );
}
