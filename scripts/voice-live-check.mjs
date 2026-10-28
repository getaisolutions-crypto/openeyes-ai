// Live check of the deployed OpenEyes voice relay: node --env-file=.env scripts/voice-live-check.mjs [audio.raw]
// Optional argument: raw 16 kHz 16-bit mono PCM speech to transcribe. Without it, 2 seconds of silence are sent.
// Prints only event types, codes and timings, plus transcripts of the supplied test audio. Never prints keys.
import { readFileSync } from 'node:fs';

const base = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const url = `${base}/functions/v1/openeyes-voice`;
const audio = process.argv[2] ? new Uint8Array(readFileSync(process.argv[2])) : new Uint8Array(32000 * 2);

const res = await fetch(url, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}` } });
const body = await res.json();
console.log('ticket status', res.status, body.ticket ? 'ticket issued' : JSON.stringify(body));
if (!body.ticket) process.exit(1);

const wsUrl = `${url.replace(/^http/, 'ws')}?ticket=${body.ticket}`;
const started = Date.now();
const events = [];
let pump;
const ws = new WebSocket(wsUrl);
ws.binaryType = 'arraybuffer';
ws.onopen = () => console.log('relay socket open after', Date.now() - started, 'ms');
ws.onerror = () => console.log('socket error');
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  events.push([msg.type, msg.code, msg.reason].filter(Boolean).join(':'));
  if (msg.text) console.log(`${msg.type}${msg.final ? ' (final)' : ''}:`, msg.text);
  if (msg.type === 'ready') {
    console.log('Meta handshake acknowledged after', Date.now() - started, 'ms');
    let offset = 0;
    pump = setInterval(() => {
      if (offset < audio.length) {
        ws.send(audio.slice(offset, offset + 2560));
        offset += 2560;
      } else if (offset < audio.length + 2560 * 12) {
        ws.send(new Uint8Array(2560));
        offset += 2560;
      } else {
        clearInterval(pump);
        ws.send(JSON.stringify({ type: 'end' }));
      }
    }, 80);
  }
};
ws.onclose = (e) => {
  clearInterval(pump);
  console.log('closed', e.code, 'after', Date.now() - started, 'ms; events:', events.join(', '));
  const again = new WebSocket(wsUrl);
  again.onopen = () => {
    console.log('ticket reuse: UNEXPECTEDLY accepted');
    again.close();
  };
  again.onerror = () => console.log('ticket reuse: refused (expected)');
};
