import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { DEFAULT_MODEL, handleRequest } from "./core.ts";

const QUOTA_LIMIT = 30;
const QUOTA_WINDOW_SECONDS = 600;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve((req: Request) =>
  handleRequest(req, {
    apiKey: Deno.env.get("MODEL_API_KEY") || undefined,
    model: Deno.env.get("META_MODEL_ID") || DEFAULT_MODEL,
    fetchImpl: fetch,
    consumeQuota: async (clientHash) => {
      const { data, error } = await supabase.rpc("consume_ai_quota", {
        p_client_hash: clientHash,
        p_limit: QUOTA_LIMIT,
        p_window_seconds: QUOTA_WINDOW_SECONDS,
      });
      if (error) throw error;
      return data === true;
    },
  })
);
