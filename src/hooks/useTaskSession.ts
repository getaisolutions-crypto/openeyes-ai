import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useReloadParticipant } from './useAppUpdate';
import { aiErrorMessage } from './useAIRequest';
import {
  applyTaskCommand,
  isTaskSession,
  offerTask,
  phraseTaskState,
  withPlan,
  type TaskCommand,
  type TaskSession,
} from '../services/tasks/taskSession';
import { createId } from '../utils/id';
import { STORAGE_KEYS, readJSON, removeKey, writeJSON } from '../utils/storage';

function loadPaused(): TaskSession | null {
  const raw = readJSON<unknown>(STORAGE_KEYS.pausedTask, null);
  return isTaskSession(raw) && raw.status === 'paused' ? raw : null;
}

export function isTaskOpen(session: TaskSession | null): boolean {
  return Boolean(session && ['offered', 'planning', 'active', 'paused'].includes(session.status));
}

/** Guided step-by-step tasks. Replies are returned to the caller, which speaks them through the existing voice. */
export function useTaskSession() {
  const { ai } = useServices();
  const [session, setSession] = useState<TaskSession | null>(loadPaused);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (session?.status === 'paused') writeJSON(STORAGE_KEYS.pausedTask, session);
    else removeKey(STORAGE_KEYS.pausedTask);
  }, [session]);

  const cancelPlanning = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancelPlanning, [cancelPlanning]);

  const offer = useCallback(
    (task: string): string => {
      cancelPlanning();
      const next = offerTask(createId(), task);
      setSession(next);
      return phraseTaskState(next, 'start');
    },
    [cancelPlanning],
  );

  const command = useCallback(
    async (cmd: TaskCommand): Promise<string> => {
      const current = sessionRef.current;
      if (!current) return 'There is no task in progress.';
      if (cmd === 'stop') cancelPlanning();
      const next = applyTaskCommand(current, cmd);
      setSession(next);
      if (next.status !== 'planning') return phraseTaskState(next, cmd);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const plan = await ai.planTask(next.task, { signal: controller.signal });
        if (controller.signal.aborted) return '';
        const planned = withPlan(next, plan.steps);
        setSession(planned);
        return phraseTaskState(planned, 'planned');
      } catch (err) {
        if (controller.signal.aborted) return '';
        setSession({ ...next, status: 'stopped' });
        return `${aiErrorMessage(err)} The task was not started.`;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [ai, cancelPlanning],
  );

  const clear = useCallback(() => {
    cancelPlanning();
    setSession(null);
  }, [cancelPlanning]);

  useReloadParticipant('Guided task', session?.status === 'planning', cancelPlanning);

  return { session, open: isTaskOpen(session), offer, command, clear };
}
