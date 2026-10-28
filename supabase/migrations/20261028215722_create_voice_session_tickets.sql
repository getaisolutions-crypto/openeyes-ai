/*
# Voice transcription session tickets and usage limits

1. Purpose
   - Lets the OpenEyes voice relay hand out short-lived, single-use "tickets" so a phone can open one
     speech-to-text connection without ever seeing the Meta API key.
   - Limits how many voice sessions and how many seconds of audio one network address can use, to protect the
     Meta budget from abuse.

2. New Tables
   - `voice_session_tickets`
     - `id` (uuid, primary key)
     - `ticket_hash` (text, unique) - SHA-256 of the ticket. The ticket itself is never stored.
     - `client_hash` (text) - SHA-256 of the caller's network address. No raw IPs.
     - `created_at` (timestamptz)
     - `expires_at` (timestamptz) - tickets are only valid for a few seconds.
     - `used_at` (timestamptz, nullable) - set when the relay connection is opened; a ticket works once.
     - `audio_ms` (int) - milliseconds of audio forwarded to Meta during the session, recorded when it closes.

3. New Functions (server only)
   - `issue_voice_ticket(p_client_hash, p_ticket_hash, p_ttl_seconds, p_max_tickets, p_window_seconds, p_max_audio_ms, p_audio_window_seconds)`
     returns text: 'ok', 'too-many-sessions' or 'audio-limit'. Removes rows older than one day.
   - `claim_voice_ticket(p_ticket_hash)` returns uuid of the ticket if it is unused and unexpired, marking it used.
   - `record_voice_usage(p_ticket_id, p_audio_ms)` stores the audio duration of a finished session.

4. Security
   - RLS enabled with no policies; anon and authenticated have no table access at all.
   - Only `service_role` (the relay server function) has table access and EXECUTE on the functions.
   - EXECUTE revoked from PUBLIC, anon and authenticated.

5. Notes
   1. No audio and no transcripts are ever stored. Only hashes, timestamps and durations, kept for 24 hours.
*/

CREATE TABLE IF NOT EXISTS voice_session_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash text NOT NULL UNIQUE,
  client_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  audio_ms int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS voice_session_tickets_client_created_idx ON voice_session_tickets (client_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_session_tickets_created_idx ON voice_session_tickets (created_at);

ALTER TABLE voice_session_tickets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON voice_session_tickets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_session_tickets TO service_role;

CREATE OR REPLACE FUNCTION issue_voice_ticket(
  p_client_hash text,
  p_ticket_hash text,
  p_ttl_seconds int,
  p_max_tickets int,
  p_window_seconds int,
  p_max_audio_ms int,
  p_audio_window_seconds int
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count int;
  recent_audio bigint;
BEGIN
  IF p_client_hash IS NULL OR length(p_client_hash) = 0 OR p_ticket_hash IS NULL OR length(p_ticket_hash) < 32
     OR p_ttl_seconds < 1 OR p_max_tickets < 1 OR p_window_seconds < 1 OR p_max_audio_ms < 1 OR p_audio_window_seconds < 1 THEN
    RETURN 'invalid';
  END IF;

  DELETE FROM voice_session_tickets WHERE created_at < now() - interval '1 day';

  PERFORM pg_advisory_xact_lock(hashtext('voice:' || p_client_hash));

  SELECT count(*) INTO recent_count
  FROM voice_session_tickets
  WHERE client_hash = p_client_hash
    AND created_at > now() - make_interval(secs => p_window_seconds);

  IF recent_count >= p_max_tickets THEN
    RETURN 'too-many-sessions';
  END IF;

  SELECT coalesce(sum(audio_ms), 0) INTO recent_audio
  FROM voice_session_tickets
  WHERE client_hash = p_client_hash
    AND created_at > now() - make_interval(secs => p_audio_window_seconds);

  IF recent_audio >= p_max_audio_ms THEN
    RETURN 'audio-limit';
  END IF;

  INSERT INTO voice_session_tickets (ticket_hash, client_hash, expires_at)
  VALUES (p_ticket_hash, p_client_hash, now() + make_interval(secs => p_ttl_seconds));
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION claim_voice_ticket(p_ticket_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed uuid;
BEGIN
  UPDATE voice_session_tickets
  SET used_at = now()
  WHERE ticket_hash = p_ticket_hash
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING id INTO claimed;
  RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION record_voice_usage(p_ticket_id uuid, p_audio_ms int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE voice_session_tickets
  SET audio_ms = greatest(0, least(p_audio_ms, 600000))
  WHERE id = p_ticket_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION issue_voice_ticket(text, text, int, int, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_voice_ticket(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_voice_usage(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_voice_ticket(text, text, int, int, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION claim_voice_ticket(text) TO service_role;
GRANT EXECUTE ON FUNCTION record_voice_usage(uuid, int) TO service_role;
