// Runtime-agnostic logic for the OpenEyes voice relay. No Deno globals, so it can be unit tested.
// Contract verified against https://dev.meta.ai/docs/speech-to-text (realtime WebSocket API).

export const META_REALTIME_URL = "wss://api.meta.ai/v1/asr/realtime";
export const VOICE_MODEL = "muse-voice-transcribe-1.0";
export const SAMPLE_RATE = 16_000;
export const AUDIO_ENCODING = "PCM_16KHZ";
/** 16 kHz, 16-bit, mono. */
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;
export const FRAME_MS = 80;

export const RELAY_LIMITS = {
  ticketTtlSeconds: 30,
  maxTicketsPerWindow: 60,
  ticketWindowSeconds: 600,
  maxAudioMsPerWindow: 20 * 60_000,
  audioWindowSeconds: 3600,
  /** One relay connection covers one listening turn; Edge Functions also have a wall-clock limit. */
  connectionMaxMs: 60_000,
  /** Meta closes the stream if the handshake is not acknowledged quickly; it allows 10 seconds. */
  handshakeTimeoutMs: 10_000,
  /** Time allowed after endStream for the final events before the relay closes anyway. */
  drainMs: 4_000,
  maxFrameBytes: 6_400,
  /** Meta rejects audio more than 5 s ahead of real time; the relay refuses anything faster than 3 s ahead. */
  maxAheadMs: 3_000,
  preReadyBufferBytes: BYTES_PER_SECOND * 4,
} as const;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export type ClientEvent =
  | { type: "ready" }
  | { type: "speechStart"; turnId: string }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "speechEnd"; turnId: string }
  | { type: "speechComplete"; turnId: string; text: string }
  | { type: "error"; code: RelayErrorCode }
  | { type: "closed"; reason: CloseReason };

export type RelayErrorCode =
  | "upstream_error"
  | "upstream_timeout"
  | "upstream_unreachable"
  | "audio_policy"
  | "session_limit";

export type CloseReason = "normal" | "rejected" | "server" | "rate-limited" | "closed";

export function buildHandshake(apiKey: string) {
  return {
    authorization: { accessToken: `Bearer ${apiKey}` },
    audioEncoding: AUDIO_ENCODING,
    model: VOICE_MODEL,
    mode: "ENDPOINTING",
    partialMode: "CUMULATIVE",
    emitAudioProgress: false,
  };
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The handshake acknowledgement is the only server message without a type; it carries the session id. */
export function isHandshakeAck(raw: string): boolean {
  const msg = parse(raw);
  return Boolean(msg && msg.type === undefined && typeof msg.sessionId === "string");
}

export function isUpstreamError(raw: string): boolean {
  return parse(raw)?.type === "error";
}

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const id = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 64) : "");

/** Forwards only documented events, with only the fields the app uses. Unknown events are dropped. */
export function toClientEvent(raw: string): ClientEvent | null {
  const msg = parse(raw);
  if (!msg) return null;
  switch (msg.type) {
    case "speechStart":
      return { type: "speechStart", turnId: id(msg.turnId) };
    case "transcript":
      return { type: "transcript", text: str(msg.transcript), final: msg.final === true };
    case "speechEnd":
      return { type: "speechEnd", turnId: id(msg.turnId) };
    case "speechComplete":
      return { type: "speechComplete", turnId: id(msg.turnId), text: str(msg.transcript) };
    case "error":
      return { type: "error", code: "upstream_error" };
    default:
      return null;
  }
}

export function closeReason(code: number): CloseReason {
  if (code === 1000) return "normal";
  if (code === 1008) return "rejected";
  if (code === 1011) return "server";
  if (code === 1013) return "rate-limited";
  return "closed";
}

export type AudioVerdict = "ok" | "frame-too-large" | "too-fast" | "too-long";

/** Enforces frame size, real-time pacing and a maximum duration on client audio. */
export function createAudioBudget(now: () => number) {
  let firstAt: number | null = null;
  let bytes = 0;
  return {
    accept(size: number): AudioVerdict {
      if (size <= 0 || size > RELAY_LIMITS.maxFrameBytes || size % 2 !== 0) return "frame-too-large";
      const t = now();
      if (firstAt === null) firstAt = t;
      const next = bytes + size;
      if (next > (RELAY_LIMITS.connectionMaxMs / 1000) * BYTES_PER_SECOND) return "too-long";
      const allowed = ((t - firstAt + RELAY_LIMITS.maxAheadMs) / 1000) * BYTES_PER_SECOND;
      if (next > allowed) return "too-fast";
      bytes = next;
      return "ok";
    },
    get audioMs() {
      return Math.round((bytes / BYTES_PER_SECOND) * 1000);
    },
  };
}

export interface SocketLike {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

const OPEN = 1;

export interface RelayDeps {
  client: SocketLike;
  connectUpstream(): SocketLike;
  apiKey: string;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Called once with the audio forwarded to Meta. Never receives audio or transcripts. */
  onFinished(audioMs: number, outcome: string): void;
}

/**
 * One listening turn: client audio -> Meta Muse Voice Transcribe, Meta events -> client.
 * The Meta key only ever appears in the first upstream frame, server side.
 */
export function createRelaySession(deps: RelayDeps) {
  const budget = createAudioBudget(deps.now);
  let upstream: SocketLike | null = null;
  let ready = false;
  let ending = false;
  let finished = false;
  let buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  const timers: unknown[] = [];

  const timer = (fn: () => void, ms: number) => timers.push(deps.setTimer(fn, ms));

  function sendClient(event: ClientEvent) {
    if (deps.client.readyState === OPEN) deps.client.send(JSON.stringify(event));
  }

  function finish(outcome: string, closeEvent: CloseReason) {
    if (finished) return;
    finished = true;
    timers.forEach((t) => deps.clearTimer(t));
    sendClient({ type: "closed", reason: closeEvent });
    if (deps.client.readyState === OPEN) deps.client.close(1000, outcome);
    if (upstream && upstream.readyState === OPEN) upstream.close(1000, "relay closed");
    buffered = [];
    deps.onFinished(budget.audioMs, outcome);
  }

  function fail(code: RelayErrorCode, closeEvent: CloseReason = "closed") {
    if (finished) return;
    sendClient({ type: "error", code });
    finish(code, closeEvent);
  }

  function endStream() {
    if (finished || ending) return;
    ending = true;
    if (ready && upstream?.readyState === OPEN) {
      upstream.send(JSON.stringify({ type: "endStream" }));
      timer(() => finish("drain-timeout", "normal"), RELAY_LIMITS.drainMs);
    } else {
      finish("ended-before-ready", "normal");
    }
  }

  return {
    start() {
      try {
        upstream = deps.connectUpstream();
      } catch {
        fail("upstream_unreachable");
        return;
      }
      timer(() => {
        if (!ready) fail("upstream_timeout");
      }, RELAY_LIMITS.handshakeTimeoutMs);
      timer(() => {
        sendClient({ type: "error", code: "session_limit" });
        endStream();
      }, RELAY_LIMITS.connectionMaxMs);
    },

    onUpstreamOpen() {
      if (finished || !upstream) return;
      upstream.send(JSON.stringify(buildHandshake(deps.apiKey)));
    },

    onUpstreamMessage(data: unknown) {
      if (finished || typeof data !== "string") return;
      if (!ready) {
        if (isHandshakeAck(data)) {
          ready = true;
          sendClient({ type: "ready" });
          for (const frame of buffered) upstream?.send(frame);
          buffered = [];
          bufferedBytes = 0;
        } else if (isUpstreamError(data)) {
          fail("upstream_error", "rejected");
        }
        return;
      }
      const event = toClientEvent(data);
      if (event) sendClient(event);
    },

    onUpstreamClose(code: number) {
      if (finished) return;
      if (!ready) fail("upstream_error", closeReason(code));
      else finish(`upstream-${code}`, closeReason(code));
    },

    onUpstreamError() {
      if (!finished && !ready) fail("upstream_unreachable");
    },

    onClientMessage(data: unknown) {
      if (finished) return;
      if (typeof data === "string") {
        const msg = parse(data);
        if (msg?.type === "end") endStream();
        return;
      }
      const frame = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
      if (!frame || ending) return;
      const verdict = budget.accept(frame.byteLength);
      if (verdict !== "ok") {
        fail(verdict === "too-long" ? "session_limit" : "audio_policy", "rejected");
        return;
      }
      if (ready) {
        upstream?.send(frame);
      } else if (bufferedBytes + frame.byteLength <= RELAY_LIMITS.preReadyBufferBytes) {
        buffered.push(frame);
        bufferedBytes += frame.byteLength;
      }
    },

    onClientClose() {
      if (finished) return;
      if (ready && upstream?.readyState === OPEN) upstream.send(JSON.stringify({ type: "endStream" }));
      finish("client-closed", "normal");
    },

    get audioMs() {
      return budget.audioMs;
    },
  };
}

export type TicketResult = "ok" | "too-many-sessions" | "audio-limit" | "invalid";

export interface TicketDeps {
  apiKey?: string;
  /** The public app key; requests without it are refused so random callers need the app's own key. */
  appKey?: string;
  /** Project reference from the Supabase URL, used to recognise this project's anon key. */
  projectRef?: string;
  issueTicket(clientHash: string, ticketHash: string): Promise<TicketResult>;
  randomToken(): string;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientId(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const value = JSON.parse(atob(padded));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The app key is public by design, so this is a filter rather than a secret check: it must be this project's
 * anon key. Abuse protection comes from single-use tickets and the per-address session and audio limits.
 */
export function hasAppKey(req: Request, appKey: string | undefined, projectRef?: string): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const presented = req.headers.get("apikey") || bearer;
  if (!presented) return false;
  if (appKey && presented === appKey) return true;
  if (!projectRef) return false;
  const claims = jwtClaims(presented);
  const exp = typeof claims?.exp === "number" ? claims.exp : 0;
  return claims?.role === "anon" && claims?.ref === projectRef && exp * 1000 > Date.now();
}

export const TICKET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** GET: whether voice transcription is configured. POST: a single-use ticket for one relay connection. */
export async function handleTicketRequest(req: Request, deps: TicketDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method === "GET") return json(200, { configured: Boolean(deps.apiKey), model: VOICE_MODEL });
    if (req.method !== "POST") return json(405, { error: { code: "invalid_request", message: "Method not allowed." } });
    if (!hasAppKey(req, deps.appKey, deps.projectRef)) return json(401, { error: { code: "unauthorized", message: "Not allowed." } });
    if (!deps.apiKey) {
      return json(503, { error: { code: "not_configured", message: "Voice transcription is not set up on the server." } });
    }
    const ticket = deps.randomToken();
    let result: TicketResult;
    try {
      result = await deps.issueTicket(await sha256(clientId(req)), await sha256(ticket));
    } catch {
      return json(503, { error: { code: "quota_unavailable", message: "OpenEyes could not check its usage limit." } });
    }
    if (result !== "ok") {
      return json(
        429,
        { error: { code: "quota_exceeded", message: "Voice transcription limit reached. Please wait.", retryAfterSeconds: 60 } },
        { "Retry-After": "60" },
      );
    }
    return json(200, {
      ticket,
      expiresInSeconds: RELAY_LIMITS.ticketTtlSeconds,
      model: VOICE_MODEL,
      sampleRate: SAMPLE_RATE,
      frameMs: FRAME_MS,
      maxSessionMs: RELAY_LIMITS.connectionMaxMs,
    });
  } catch {
    return json(500, { error: { code: "internal_error", message: "Something went wrong on the OpenEyes server." } });
  }
}
