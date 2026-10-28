import { AIRequestError, type AIErrorKind } from '../../types/ai';

export const DEFAULT_TIMEOUT_MS = 60_000;

export const AI_ERROR_MESSAGES: Record<AIErrorKind, string> = {
  'not-configured':
    'Meta AI is not set up on the OpenEyes server yet, so OpenEyes cannot answer. Nothing was sent to Meta.',
  auth: 'The OpenEyes server could not sign in to Meta AI. The Meta API key may be wrong or expired.',
  'rate-limited': 'Too many requests right now. Please wait a minute and try again.',
  timeout: 'Meta AI took too long to answer. Please try again.',
  network: 'OpenEyes could not reach its server. Check your internet connection and try again.',
  'unsupported-image': 'This photo format cannot be processed. Please use a JPEG, PNG or WebP photo.',
  'image-too-large': 'This photo is too large to send, even after shrinking it. Please take a new photo.',
  rejected: 'Meta AI could not process this request. Try a different photo or question.',
  'bad-response': 'Meta AI sent an answer OpenEyes could not understand. Please try again.',
  server: 'Something went wrong on the OpenEyes server. Please try again.',
  cancelled: 'Request cancelled.',
};

const CODE_TO_KIND: Record<string, AIErrorKind> = {
  not_configured: 'not-configured',
  invalid_request: 'rejected',
  unsupported_image: 'unsupported-image',
  image_too_large: 'image-too-large',
  quota_exceeded: 'rate-limited',
  quota_unavailable: 'server',
  meta_auth_failed: 'auth',
  meta_rate_limited: 'rate-limited',
  meta_rejected: 'rejected',
  meta_timeout: 'timeout',
  meta_unreachable: 'network',
  meta_error: 'server',
  meta_bad_response: 'bad-response',
  internal_error: 'server',
};

export interface BackendConfig {
  /** Full URL of the OpenEyes AI server function. */
  url: string;
  /** Public (anon) key that identifies this app to the server. Not a secret. */
  publicKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OpenEyesBackend {
  post(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  health(signal?: AbortSignal): Promise<{ configured: boolean; model?: string }>;
}

export function getBackendConfigFromEnv(): BackendConfig | null {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !publicKey) return null;
  return { url: `${base.replace(/\/$/, '')}/functions/v1/openeyes-ai`, publicKey };
}

function errorFor(kind: AIErrorKind, retryAfterSeconds?: number) {
  return new AIRequestError(kind, AI_ERROR_MESSAGES[kind], retryAfterSeconds);
}

function kindForStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 413) return 'image-too-large';
  if (status === 415) return 'unsupported-image';
  if (status === 429) return 'rate-limited';
  if (status === 503) return 'not-configured';
  if (status === 504) return 'timeout';
  if (status >= 400 && status < 500) return 'rejected';
  return 'server';
}

export function createOpenEyesBackend(config: BackendConfig): OpenEyesBackend {
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw errorFor('cancelled');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      let response: Response;
      try {
        response = await fetchImpl(config.url, {
          ...init,
          headers: {
            Authorization: `Bearer ${config.publicKey}`,
            apikey: config.publicKey,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });
      } catch {
        if (timedOut) throw errorFor('timeout');
        if (signal?.aborted) throw errorFor('cancelled');
        throw errorFor('network');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (signal?.aborted) throw errorFor('cancelled');
        if (timedOut) throw errorFor('timeout');
        throw errorFor(response.ok ? 'bad-response' : kindForStatus(response.status));
      }

      if (!response.ok) {
        const err = (body as { error?: { code?: unknown; retryAfterSeconds?: unknown } } | null)?.error;
        const kind = (typeof err?.code === 'string' && CODE_TO_KIND[err.code]) || kindForStatus(response.status);
        const retry = typeof err?.retryAfterSeconds === 'number' ? err.retryAfterSeconds : undefined;
        throw errorFor(kind, retry);
      }
      if (typeof body !== 'object' || body === null) throw errorFor('bad-response');
      return body as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    post: (payload, signal) => send({ method: 'POST', body: JSON.stringify(payload) }, signal),
    async health(signal) {
      const body = await send({ method: 'GET' }, signal);
      return {
        configured: body.configured === true,
        model: typeof body.model === 'string' ? body.model : undefined,
      };
    },
  };
}
