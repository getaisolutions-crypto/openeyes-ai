import type { ListeningHandlers, ListeningSession, SpeechErrorKind, SpeechRecognizer } from '../../types/voice';
import { isPcmCaptureSupported, startPcmCapture, type PcmCapture } from './pcmCapture';

export const META_VOICE_LIMITS = {
  /** Time to get a ticket, open the relay and receive Meta's handshake acknowledgement. */
  connectTimeoutMs: 8_000,
  /** End the turn if Meta reports no speech start within this time after it is ready. */
  noSpeechMs: 8_000,
  /** Ask Meta to finish the turn after this long; the relay itself allows 60 seconds. */
  maxTurnMs: 45_000,
  /** Time to wait for the final transcript after asking Meta to finish. */
  drainMs: 4_000,
  /** Audio kept while connecting (about 4 seconds), so the start of a question is not lost. */
  maxBufferedFrames: 50,
} as const;

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export interface MetaVoiceConfig {
  /** Full https URL of the openeyes-voice server function. */
  functionUrl: string;
  /** Public app key. Not a secret; the Meta key never leaves the server. */
  publicKey: string;
  fetchImpl?: typeof fetch;
  createSocket?: (url: string) => WebSocketLike;
  startCapture?: (onFrame: (frame: ArrayBuffer) => void) => Promise<PcmCapture>;
  isCaptureSupported?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

export function getMetaVoiceConfigFromEnv(): Pick<MetaVoiceConfig, 'functionUrl' | 'publicKey'> | null {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !publicKey) return null;
  return { functionUrl: `${base.replace(/\/$/, '')}/functions/v1/openeyes-voice`, publicKey };
}

function parseEvent(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const value = JSON.parse(data);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Meta Muse Voice Transcribe through the OpenEyes relay. One relay connection per listening turn, so the
 * microphone and the stream are closed while OpenEyes speaks and its own voice is never transcribed.
 * Turn end comes from Meta's own endpointing (speechComplete); partial transcripts are only shown, never sent.
 */
export function createMetaVoiceRecognizer(config: MetaVoiceConfig): SpeechRecognizer {
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const createSocket = config.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  const startCapture = config.startCapture ?? startPcmCapture;
  const captureSupported = config.isCaptureSupported ?? isPcmCaptureSupported;
  const setTimer = config.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = config.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  return {
    id: 'meta-voice',
    isSupported: () => captureSupported() && typeof WebSocket !== 'undefined',

    startListening(handlers: ListeningHandlers): ListeningSession {
      let ended = false;
      let ready = false;
      let finalSent = false;
      let ending = false;
      let capture: PcmCapture | null = null;
      let socket: WebSocketLike | null = null;
      let buffered: ArrayBuffer[] = [];
      const timers = new Map<string, unknown>();
      const abortFetch = new AbortController();

      const setNamed = (name: string, fn: () => void, ms: number) => {
        const old = timers.get(name);
        if (old !== undefined) clearTimer(old);
        timers.set(name, setTimer(fn, ms));
      };
      const clearNamed = (name: string) => {
        const old = timers.get(name);
        if (old !== undefined) clearTimer(old);
        timers.delete(name);
      };

      const cleanup = () => {
        timers.forEach((t) => clearTimer(t));
        timers.clear();
        abortFetch.abort();
        capture?.stop();
        capture = null;
        buffered = [];
        const s = socket;
        socket = null;
        if (s) {
          s.onmessage = null;
          s.onclose = null;
          s.onerror = null;
          s.onopen = null;
          if (s.readyState === OPEN) {
            try {
              s.send(JSON.stringify({ type: 'end' }));
            } catch {
              // closing anyway
            }
          }
          try {
            s.close(1000);
          } catch {
            // already closed
          }
        }
      };

      const end = (error: SpeechErrorKind | null) => {
        if (ended) return;
        ended = true;
        cleanup();
        if (error) handlers.onError(error);
        handlers.onEnd();
      };

      const finishTurn = () => {
        if (ended || ending) return;
        ending = true;
        // Stop the microphone at once; only Meta's final words for audio already sent are awaited.
        capture?.stop();
        capture = null;
        if (socket?.readyState === OPEN && ready) socket.send(JSON.stringify({ type: 'end' }));
        setNamed('drain', () => end(null), META_VOICE_LIMITS.drainMs);
      };

      const onFrame = (frame: ArrayBuffer) => {
        if (ended || ending) return;
        if (ready && socket?.readyState === OPEN) socket.send(frame);
        else if (buffered.length < META_VOICE_LIMITS.maxBufferedFrames) buffered.push(frame);
      };

      const onMessage = (data: unknown) => {
        const event = parseEvent(data);
        if (!event || ended) return;
        switch (event.type) {
          case 'ready': {
            ready = true;
            clearNamed('connect');
            for (const frame of buffered) socket?.send(frame);
            buffered = [];
            setNamed('no-speech', () => end('no-speech'), META_VOICE_LIMITS.noSpeechMs);
            setNamed('max-turn', finishTurn, META_VOICE_LIMITS.maxTurnMs);
            return;
          }
          case 'speechStart':
            clearNamed('no-speech');
            return;
          case 'transcript': {
            const text = typeof event.text === 'string' ? event.text.trim() : '';
            if (text && !finalSent && !ending) handlers.onInterim?.(text);
            return;
          }
          case 'speechComplete': {
            const text = typeof event.text === 'string' ? event.text.trim() : '';
            if (finalSent) return;
            if (!text) {
              // Noise or an empty turn: keep listening for a real question.
              if (!ending) setNamed('no-speech', () => end('no-speech'), META_VOICE_LIMITS.noSpeechMs);
              return;
            }
            finalSent = true;
            handlers.onFinal(text);
            end(null);
            return;
          }
          case 'error':
            if (event.code === 'session_limit') finishTurn();
            else end(finalSent ? null : 'service-unavailable');
            return;
          case 'closed':
            end(ready && (event.reason === 'normal' || ending) ? null : 'service-unavailable');
            return;
          default:
            return;
        }
      };

      setNamed('connect', () => end('service-unavailable'), META_VOICE_LIMITS.connectTimeoutMs);

      startCapture(onFrame).then(
        (c) => {
          if (ended || ending) c.stop();
          else capture = c;
        },
        (error: unknown) => {
          const kind = typeof error === 'string' ? (error as SpeechErrorKind) : 'audio-capture';
          end(kind === 'aborted' ? null : kind);
        },
      );

      void (async () => {
        let ticket: string;
        try {
          const response = await fetchImpl(config.functionUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.publicKey}`, apikey: config.publicKey },
            signal: abortFetch.signal,
          });
          const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null;
          if (!response.ok || typeof body?.ticket !== 'string') throw new Error('ticket');
          ticket = body.ticket;
        } catch {
          end('service-unavailable');
          return;
        }
        if (ended) return;
        const url = `${config.functionUrl.replace(/^http/, 'ws')}?ticket=${encodeURIComponent(ticket)}`;
        try {
          socket = createSocket(url);
        } catch {
          end('service-unavailable');
          return;
        }
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (event) => onMessage(event.data);
        socket.onerror = () => end(finalSent ? null : 'service-unavailable');
        socket.onclose = () => end(finalSent || (ready && ending) ? null : 'service-unavailable');
      })();

      return {
        stop: finishTurn,
        abort: () => end('aborted'),
      };
    },
  };
}
