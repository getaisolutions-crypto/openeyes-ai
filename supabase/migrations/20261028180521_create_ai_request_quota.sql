/*
# AI request quota (server-side rate limiting)

1. Purpose
   - Protects the Meta Model API key and budget. The OpenEyes server function records one row per AI request
     and refuses new requests when a client exceeds its quota within a time window.

2. New Tables
   - `ai_request_log`
     - `id` (uuid, primary key)
     - `client_hash` (text, not null) - SHA-256 hash of the caller's network address. No raw IPs, images or text are stored.
     - `created_at` (timestamptz, default now())

3. New Functions
   - `consume_ai_quota(p_client_hash text, p_limit int, p_window_seconds int) returns boolean`
     - Deletes log rows older than one day, counts the client's requests inside the window,
       and records a new request only if the client is under the limit. Returns true when allowed.

4. Security
   - RLS enabled on `ai_request_log` with no policies: the browser (anon/authenticated) can never read or write it.
   - Only `service_role` (the server function) is granted table access and EXECUTE on the function.
   - EXECUTE revoked from PUBLIC, anon and authenticated.

5. Notes
   1. Only hashed client identifiers and timestamps are kept, and only for 24 hours.
*/

CREATE TABLE IF NOT EXISTS ai_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_request_log_client_created_idx ON ai_request_log (client_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_request_log_created_idx ON ai_request_log (created_at);

ALTER TABLE ai_request_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ai_request_log FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON ai_request_log TO service_role;

CREATE OR REPLACE FUNCTION consume_ai_quota(p_client_hash text, p_limit int, p_window_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count int;
BEGIN
  IF p_client_hash IS NULL OR length(p_client_hash) = 0 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;

  DELETE FROM ai_request_log WHERE created_at < now() - interval '1 day';

  PERFORM pg_advisory_xact_lock(hashtext(p_client_hash));

  SELECT count(*) INTO recent_count
  FROM ai_request_log
  WHERE client_hash = p_client_hash
    AND created_at > now() - make_interval(secs => p_window_seconds);

  IF recent_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO ai_request_log (client_hash) VALUES (p_client_hash);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION consume_ai_quota(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_ai_quota(text, int, int) TO service_role;
