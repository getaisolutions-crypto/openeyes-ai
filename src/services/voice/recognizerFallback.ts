import type { ListeningHandlers, ListeningSession, SpeechErrorKind, SpeechRecognizer } from '../../types/voice';

/** Meta failures in a row before the rest of the conversation uses the browser's recognizer. */
export const MAX_PRIMARY_FAILURES = 2;

export type FallbackEvent = 'turn' | 'session';

/**
 * Uses the primary recognizer (Meta) and, when it is unavailable, finishes the same turn with the fallback
 * (the browser) so the user does not have to repeat themselves. After repeated failures, or when Meta cannot
 * run in this browser, the fallback is used for the rest of the conversation. Each switch is reported.
 */
export function createRecognizerWithFallback(
  primary: SpeechRecognizer,
  fallback: SpeechRecognizer | null,
  onFallback: (event: FallbackEvent, active: SpeechRecognizer['id']) => void,
) {
  let failures = 0;
  let usePrimary = primary.isSupported();

  const switchToFallback = (event: FallbackEvent) => {
    if (event === 'session') usePrimary = false;
    onFallback(event, fallback ? fallback.id : primary.id);
  };

  return {
    get activeId(): SpeechRecognizer['id'] {
      return usePrimary || !fallback ? primary.id : fallback.id;
    },

    isSupported: () => primary.isSupported() || Boolean(fallback?.isSupported()),

    startListening(handlers: ListeningHandlers): ListeningSession {
      if (!usePrimary && fallback) return fallback.startListening(handlers);

      let current: ListeningSession | null = null;
      let cancelled = false;
      let unavailable = false;
      let heard = false;

      current = primary.startListening({
        onInterim: (text) => {
          heard = true;
          handlers.onInterim?.(text);
        },
        onFinal: (text) => {
          heard = true;
          failures = 0;
          handlers.onFinal(text);
        },
        onError: (kind: SpeechErrorKind) => {
          if (kind === 'service-unavailable' && fallback?.isSupported()) unavailable = true;
          else handlers.onError(kind);
        },
        onEnd: () => {
          if (!unavailable || cancelled) {
            handlers.onEnd();
            return;
          }
          failures++;
          const event: FallbackEvent = failures >= MAX_PRIMARY_FAILURES ? 'session' : 'turn';
          switchToFallback(event);
          if (heard) {
            // Words were already shown from Meta; ask again rather than guessing the rest.
            handlers.onError('service-unavailable');
            handlers.onEnd();
            return;
          }
          current = fallback!.startListening(handlers);
        },
      });

      return {
        stop: () => current?.stop(),
        abort: () => {
          cancelled = true;
          current?.abort();
        },
      };
    },
  };
}

export type RecognizerWithFallback = ReturnType<typeof createRecognizerWithFallback>;
