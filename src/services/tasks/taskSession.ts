export type TaskStatus = 'offered' | 'planning' | 'active' | 'paused' | 'done' | 'stopped';
export type TaskCommand = 'start' | 'decline' | 'next' | 'repeat' | 'back' | 'stop' | 'pause' | 'resume';

export interface TaskSession {
  id: string;
  task: string;
  steps: string[];
  /** Index of the step currently being shown. */
  current: number;
  completed: number[];
  status: TaskStatus;
  /** True while OpenEyes waits for the user to say they finished the current step. */
  awaitingConfirmation: boolean;
  /** Short, user-provided context (for example the task request). Never camera observations. */
  context: string;
  updatedAt: string;
}

export const MAX_TASK_STEPS = 12;

export function offerTask(id: string, task: string, now = new Date()): TaskSession {
  return {
    id,
    task,
    steps: [],
    current: 0,
    completed: [],
    status: 'offered',
    awaitingConfirmation: false,
    context: task,
    updatedAt: now.toISOString(),
  };
}

const touch = (s: TaskSession, patch: Partial<TaskSession>): TaskSession => ({
  ...s,
  ...patch,
  updatedAt: new Date().toISOString(),
});

export function withPlan(session: TaskSession, steps: string[]): TaskSession {
  const clean = steps.map((s) => s.trim()).filter(Boolean).slice(0, MAX_TASK_STEPS);
  if (clean.length === 0) return touch(session, { status: 'stopped', steps: [] });
  return touch(session, { steps: clean, current: 0, completed: [], status: 'active', awaitingConfirmation: true });
}

/** Steps only move when the user asks. Nothing advances on a timer or on what the camera sees. */
export function applyTaskCommand(session: TaskSession, command: TaskCommand): TaskSession {
  const last = session.steps.length - 1;
  switch (command) {
    case 'start':
      return session.status === 'offered' ? touch(session, { status: 'planning' }) : session;
    case 'decline':
      return session.status === 'offered' ? touch(session, { status: 'stopped' }) : session;
    case 'stop':
      return touch(session, { status: 'stopped', awaitingConfirmation: false });
    case 'pause':
      return session.status === 'active' ? touch(session, { status: 'paused' }) : session;
    case 'resume':
      return session.status === 'paused' ? touch(session, { status: 'active', awaitingConfirmation: true }) : session;
    case 'repeat':
      return session;
    case 'back':
      if (session.status !== 'active' || session.current === 0) return session;
      return touch(session, {
        current: session.current - 1,
        completed: session.completed.filter((i) => i !== session.current - 1),
        awaitingConfirmation: true,
      });
    case 'next': {
      if (session.status !== 'active') return session;
      const completed = session.completed.includes(session.current) ? session.completed : [...session.completed, session.current];
      if (session.current >= last) return touch(session, { completed, status: 'done', awaitingConfirmation: false });
      return touch(session, { completed, current: session.current + 1, awaitingConfirmation: true });
    }
  }
}

const COMMAND_PATTERNS: [TaskCommand, RegExp][] = [
  ['next', /^(next|next step|done|i'?m done|finished|i did it|ok(ay)?,? next|continue|go on)$/],
  ['repeat', /^(repeat|repeat that|say (that|it) again|again|what was that|what'?s the step)$/],
  ['back', /^(go back|back|previous|previous step|last step)$/],
  ['stop', /^(stop|stop (the )?task|cancel|end (the )?task|quit|exit)$/],
  ['pause', /^(pause|pause (the )?task|wait|hold on)$/],
  ['resume', /^(resume|resume (the )?task|carry on|keep going|let'?s continue)$/],
  ['start', /^(yes|yes please|yeah|yep|sure|start|let'?s start|ok(ay)?|go ahead)$/],
  ['decline', /^(no|no thanks|not now|nope)$/],
];

export function parseTaskCommand(text: string): TaskCommand | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(openeyes,?\s+)/, '')
    .replace(/[.!?]+$/, '')
    .trim();
  for (const [command, pattern] of COMMAND_PATTERNS) if (pattern.test(t)) return command;
  return null;
}

export function currentStepText(session: TaskSession): string {
  const step = session.steps[session.current];
  return step ? `Step ${session.current + 1} of ${session.steps.length}: ${step}` : '';
}

/** What OpenEyes says after a command. Never claims to have seen the user do anything. */
export function phraseTaskState(session: TaskSession, command: TaskCommand | 'planned'): string {
  switch (session.status) {
    case 'offered':
      return `I can guide you through the steps to ${session.task}. Would you like to start?`;
    case 'planning':
      return 'Getting the steps ready.';
    case 'stopped':
      return session.steps.length === 0 && command === 'planned'
        ? "I couldn't put together steps for that task. You can ask me a question about it instead."
        : 'Task stopped.';
    case 'paused':
      return `Task paused at step ${session.current + 1}. Say "resume" when you are ready.`;
    case 'done':
      return `That was the last step. Task finished: ${session.task}.`;
    case 'active': {
      const step = currentStepText(session);
      if (command === 'back' && session.current === 0) return `This is the first step. ${step}`;
      return `${step}. Say "next" when you have finished, "repeat" to hear it again, or "stop" to end.`;
    }
  }
}

const TASK_REQUEST =
  /^(?:openeyes,?\s+)?(?:can you\s+|could you\s+|please\s+)?(?:help me (?:to )?|guide me (?:through|to)\s+|walk me through\s+|show me how to\s+|how do i\s+)(.+?)(?:\s+step by step)?[?.!]*$/i;

/** "Help me make coffee" -> "make coffee". Find and read requests are routed elsewhere first. */
export function parseTaskRequest(text: string): string | null {
  const match = text.trim().match(TASK_REQUEST);
  if (!match) return null;
  const task = match[1].trim().replace(/^with\s+/i, '');
  if (!task || task.length > 120) return null;
  return task;
}

/** Only paused sessions are kept between visits, on this device. */
export function isTaskSession(value: unknown): value is TaskSession {
  const v = value as TaskSession;
  return (
    typeof v === 'object' && v !== null && typeof v.id === 'string' && typeof v.task === 'string' &&
    Array.isArray(v.steps) && v.steps.every((s) => typeof s === 'string') && typeof v.current === 'number' &&
    Array.isArray(v.completed) && typeof v.status === 'string'
  );
}
