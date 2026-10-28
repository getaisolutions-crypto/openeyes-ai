import { useCallback, useEffect, useRef, useState } from 'react';
import { AIRequestError, ProviderUnavailableError } from '../types/ai';
import { AI_ERROR_MESSAGES } from '../services/ai/openEyesBackend';
import { useAnnouncer } from './useAnnouncer';

export type AIRequestState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; result: T }
  | { status: 'error'; message: string };

export function aiErrorMessage(error: unknown): string {
  if (error instanceof AIRequestError || error instanceof ProviderUnavailableError) return error.message;
  return AI_ERROR_MESSAGES.server;
}

/** Runs one AI request at a time with loading announcements, cancellation and readable errors. */
export function useAIRequest<T>() {
  const { announce } = useAnnouncer();
  const [state, setState] = useState<AIRequestState<T>>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (task: (signal: AbortSignal) => Promise<T>, pendingMessage: string): Promise<T | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: 'pending' });
      announce(pendingMessage);
      try {
        const result = await task(controller.signal);
        if (controller.signal.aborted) return null;
        setState({ status: 'success', result });
        return result;
      } catch (error) {
        if (controller.signal.aborted) return null;
        const message = aiErrorMessage(error);
        setState({ status: 'error', message });
        announce(message, 'assertive');
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [announce],
  );

  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    controllerRef.current.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
    announce(AI_ERROR_MESSAGES.cancelled);
  }, [announce]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, run, cancel, reset };
}
