import { ListChecks, Loader2 } from 'lucide-react';
import type { TaskCommand, TaskSession } from '../../services/tasks/taskSession';

interface Props {
  session: TaskSession;
  onCommand: (command: TaskCommand) => void;
  onClose: () => void;
}

export function TaskPanel({ session, onCommand, onClose }: Props) {
  const { status, steps, current } = session;
  const btn = (command: TaskCommand, label: string, primary = false, disabled = false) => (
    <button
      type="button"
      className={primary ? 'btn-primary' : 'btn-secondary'}
      onClick={() => onCommand(command)}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <section aria-labelledby="task-heading" className="card mt-4 p-4 animate-fade-up">
      <h2 id="task-heading" className="flex items-center gap-2 text-xl font-bold">
        <ListChecks aria-hidden="true" className="h-6 w-6 text-primary" /> Guided task: {session.task}
      </h2>
      <p className="mt-1 text-sm text-muted">
        General steps from Meta AI. OpenEyes cannot see you doing them, so it only moves on when you say
        &ldquo;next&rdquo;. Check anything safety-related yourself.
      </p>

      {status === 'offered' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {btn('start', 'Start task', true)}
          {btn('decline', 'Not now')}
        </div>
      )}

      {status === 'planning' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="flex items-center gap-2 text-muted">
            <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" /> Getting the steps ready
          </p>
          {btn('stop', 'Stop task')}
        </div>
      )}

      {(status === 'active' || status === 'paused') && steps.length > 0 && (
        <>
          <p className="mt-3 text-lg font-bold" aria-live="polite">
            Step {current + 1} of {steps.length}
            {status === 'paused' ? ' (paused)' : ''}: {steps[current]}
          </p>
          <ol className="mt-3 space-y-1" aria-label="All steps">
            {steps.map((step, i) => (
              <li key={i} className={i === current ? 'font-bold' : 'text-muted'}>
                {i + 1}. {step}
                {session.completed.includes(i) && <span className="sr-only"> (finished)</span>}
                {i === current && <span className="sr-only"> (current step)</span>}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {status === 'active' ? (
              <>
                {btn('back', 'Previous step', false, current === 0)}
                {btn('repeat', 'Repeat step')}
                {btn('next', current === steps.length - 1 ? 'Finish task' : 'Next step', true)}
                {btn('pause', 'Pause task')}
              </>
            ) : (
              btn('resume', 'Resume task', true)
            )}
            {btn('stop', 'Stop task')}
          </div>
        </>
      )}

      {(status === 'done' || status === 'stopped') && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-lg">{status === 'done' ? 'Task finished.' : 'Task stopped.'}</p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close task
          </button>
        </div>
      )}
    </section>
  );
}
