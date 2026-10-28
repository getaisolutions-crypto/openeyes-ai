import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  META_REALTIME_URL,
  RELAY_LIMITS,
  TICKET_PATTERN,
  createRelaySession,
  handleTicketRequest,
  json,
  sha256,
  type TicketResult,
} from "./core.ts";

const apiKey = Deno.env.get("MODEL_API_KEY") || undefined;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function connectMeta(): WebSocket {
  const ws = new WebSocket(META_REALTIME_URL);
  ws.binaryType = "arraybuffer";
  return ws;
}

async function relay(req: Request, ticket: string): Promise<Response> {
  if (!apiKey) return json(503, { error: { code: "not_configured", message: "Voice transcription is not set up." } });
  if (!TICKET_PATTERN.test(ticket)) return json(401, { error: { code: "unauthorized", message: "Not allowed." } });
  const { data: ticketId, error } = await supabase.rpc("claim_voice_ticket", { p_ticket_hash: await sha256(ticket) });
  if (error) return json(503, { error: { code: "quota_unavailable", message: "Usage limit could not be checked." } });
  if (!ticketId) return json(401, { error: { code: "unauthorized", message: "Not allowed." } });

  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.binaryType = "arraybuffer";
  let upstream: WebSocket | null = null;
  const session = createRelaySession({
    client: socket,
    connectUpstream: () => {
      upstream = connectMeta();
      upstream.onopen = () => session.onUpstreamOpen();
      upstream.onmessage = (e) => session.onUpstreamMessage(e.data);
      upstream.onclose = (e) => session.onUpstreamClose(e.code);
      upstream.onerror = () => session.onUpstreamError();
      return upstream;
    },
    apiKey,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as number),
    onFinished: (audioMs, outcome) => {
      // Only durations and outcome codes are logged, never audio or words.
      console.log("openeyes-voice session", JSON.stringify({ audioMs, outcome }));
      supabase.rpc("record_voice_usage", { p_ticket_id: ticketId, p_audio_ms: audioMs }).then(({ error: e }) => {
        if (e) console.error("openeyes-voice usage not recorded");
      });
    },
  });
  socket.onopen = () => session.start();
  socket.onmessage = (e) => session.onClientMessage(e.data);
  socket.onclose = () => session.onClientClose();
  socket.onerror = () => session.onClientClose();
  return response;
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return await relay(req, url.searchParams.get("ticket") ?? "");
    }
    return await handleTicketRequest(req, {
      apiKey,
      appKey: Deno.env.get("SUPABASE_ANON_KEY") || undefined,
      projectRef: new URL(Deno.env.get("SUPABASE_URL")!).hostname.split(".")[0],
      randomToken,
      issueTicket: async (clientHash, ticketHash) => {
        const { data, error } = await supabase.rpc("issue_voice_ticket", {
          p_client_hash: clientHash,
          p_ticket_hash: ticketHash,
          p_ttl_seconds: RELAY_LIMITS.ticketTtlSeconds,
          p_max_tickets: RELAY_LIMITS.maxTicketsPerWindow,
          p_window_seconds: RELAY_LIMITS.ticketWindowSeconds,
          p_max_audio_ms: RELAY_LIMITS.maxAudioMsPerWindow,
          p_audio_window_seconds: RELAY_LIMITS.audioWindowSeconds,
        });
        if (error) throw error;
        return data as TicketResult;
      },
    });
  } catch {
    console.error("openeyes-voice internal error");
    return json(500, { error: { code: "internal_error", message: "Something went wrong on the OpenEyes server." } });
  }
});
