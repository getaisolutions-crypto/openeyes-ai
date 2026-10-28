import { useEffect, useRef, useState } from 'react';
import { Loader2, PlugZap } from 'lucide-react';
import { Notice } from './Notice';
import { useServices } from '../services/ServicesContext';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { aiErrorMessage } from '../hooks/useAIRequest';
import type { ConnectionCheck } from '../types/ai';

type CheckState = { status: 'idle' } | { status: 'pending' } | { status: 'done'; result: ConnectionCheck } | { status: 'error'; message: string };

export function MetaConnectionCheck() {
  const { ai } = useServices();
  const { announce } = useAnnouncer();
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const check = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'pending' });
    announce('Checking the Meta AI connection.');
    try {
      const result = await ai.checkConnection(controller.signal);
      setState({ status: 'done', result });
      announce(result.message);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = aiErrorMessage(err);
      setState({ status: 'error', message });
      announce(message, 'assertive');
    }
  };

  return (
    <div className="space-y-3 py-3">
      <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => void check()} disabled={state.status === 'pending'}>
        {state.status === 'pending' ? (
          <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
        ) : (
          <PlugZap aria-hidden="true" className="h-5 w-5" />
        )}
        Check Meta AI connection
      </button>
      {state.status === 'done' && (
        <Notice variant={state.result.configured ? 'success' : 'warning'} title={state.result.configured ? 'Server ready' : 'Not connected'}>
          {state.result.message}
        </Notice>
      )}
      {state.status === 'error' && (
        <Notice variant="error" title="Connection check failed">
          {state.message}
        </Notice>
      )}
    </div>
  );
}
