# OpenEyes AI

**Your World, Understood.**

OpenEyes AI is a voice-first, accessibility-first personal assistant designed to help blind and low-vision people
understand their surroundings, find objects, read text, remember important information and accomplish everyday tasks
more independently. The long-term target is Android smartphones and compatible Meta AI glasses.

> Status: **v0.4.2: app updates and cache control.** Settings now has **App & updates** (current and latest version,
> Check for updates, Clear cache & reload) and the app tells you when a newer build is published. Not yet verified on a
> real Android phone. See [App updates and caching (v0.4.2)](#app-updates-and-caching-v042).
>
> Phase 4.1 (v0.4.1): Meta Muse Voice Transcribe connected through a secure OpenEyes server relay and
> verified with real Meta API requests; the Android "tap the microphone after every answer" bug fixed in code and covered
> by automated tests. Hands-free conversation has not yet been verified on a real Android phone.** See
> [Phase 4.1](#phase-41-meta-voice-transcribe-and-hands-free-fix).
>
> Phase 4 (v0.4.0): voice conversation. Explore now has **Start Voice Conversation**: a foreground, back-and-forth spoken conversation that
> listens again after each reply and ends when you say or tap stop. Natural (neural) voices are prepared but **not
> connected**; the browser voice is still used. See [Voice conversation (Phase 4)](#voice-conversation-phase-4).
>
> Phase 3 (v0.3.0): Live Explore and interactive voice companion. On top of Phase 2 (scene
> description, object finding, text reading and conversation through Meta's **Muse Spark** model), Explore now offers a
> live camera session you can talk to. The Meta API key (`MODEL_API_KEY`) is configured on the server and the project
> owner reports real answers on an Android phone; real-device testing of Live Explore is still in progress (see
> [Remaining real-device testing](#remaining-real-device-testing)). **Meta glasses cannot be connected yet.**

## Hackathon

- Event: Meta Global AI Developer Hackathon, October 27 - November 4, 2026
- Repository: `getaisolutions-crypto/openeyes-ai` (public)
- All functionality is developed during the event. Progress is recorded in [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).

## Technology stack

- React 18 + TypeScript (strict)
- Vite 5
- Tailwind CSS 3 (CSS-variable based theming for dark, light and high-contrast)
- React Router 6 (lazy-loaded routes)
- lucide-react icons (ISC license)
- Atkinson Hyperlegible font (SIL Open Font License, Braille Institute), loaded from Google Fonts
- Supabase Edge Functions (Deno) for the server-side Meta API proxy, Supabase Postgres for request rate limiting
- Vitest + Testing Library + axe-core for tests

## Installation and development

Requires Node.js 18 or newer.

```bash
npm install
npm run dev        # start the development server
npm test           # run the test suite once
npm run typecheck  # TypeScript checks
npm run build      # type-check and produce a production build in dist/
npm run preview    # serve the production build locally
```

Camera and microphone access only work on `https://` origins or `localhost`.

## What works today

| Area | Working now |
| --- | --- |
| Home | Title, tagline, "Talk to OpenEyes" button, quick actions, live device and microphone status, visible latest-status region |
| Assistant | Browser speech recognition, typed input, conversation history, optional photo attachment, Meta AI replies (needs server key), "Remember that..." with confirmation before saving, relevant saved memories shared as background, Cancel, Stop speaking, Clear conversation |
| Explore | **Live Explore** (Phase 3): live camera session in Ask only, Smart Explore or Continuous mode, spoken answers, voice and typed commands, transcript. **Single photo** mode is kept: capture, then **Describe my surroundings** (Muse Spark) with Read aloud / Pause / Stop and a safety note |
| Find | Item name by typing or voice, camera capture, then **Find** (Muse Spark): visible / not seen / not sure, relative position, confidence, next-step suggestion. Saved memories shown separately and labelled as past notes |
| Read | Camera capture or photo upload, **Read text from photo** (Muse Spark) fills the read-aloud box with line breaks kept; "No readable text found" when nothing is readable; paste/type text; read aloud with the device voice |
| Memory | Save (explicit action only), view, edit, delete (with confirmation), search; dictate a memory by voice |
| Devices | Phone camera and microphone availability and permission state; Meta Glasses shown as **Not Connected** |
| Trusted Circle | Add, view, edit, remove contacts; Call / Email open the phone or email app only after a confirmation dialog |
| Settings | Themes, high contrast, text sizes, reduce motion, spoken replies, speech rate, **device voice**, response length, **Live Explore defaults** (mode, time between frames, session limit), privacy, permissions info, Meta model list, **Check Meta AI connection** |

## Live Explore (Phase 3)

Live Explore turns the Explore screen into a camera session you can talk to. Every description comes from Muse Spark
analysing a real camera frame; OpenEyes never invents observations, and if no frame was analysed it says so.

### Starting, pausing and stopping

- **Start exploring** asks for camera permission. The first time, a dialog ("Before Live Explore starts") explains that
  camera frames are sent to Meta AI and asks for agreement before the camera turns on.
- **Pause exploring / Resume exploring**: while paused, the camera stays on but **nothing is sent**.
- **Stop exploring** turns the camera off (every camera track is stopped), cancels any request in progress and clears the
  in-memory frames. **Describe now** analyses the current view immediately. **Cancel request** cancels a pending answer.
- Starting and stopping are confirmed by voice ("Camera on. Live Explore started...", "Exploring stopped. Camera off.").
- A text badge always shows the camera state: "Camera on, waiting for your question", "Camera on, exploring",
  "Camera on, paused. Nothing is being sent.", "Camera on, waiting for Meta AI".
- If camera permission is denied or no camera is available, a clear message is shown and spoken; nothing else breaks.
- **Single photo** mode is unchanged below Live Explore. It is paused while Live Explore is using the camera.

### Modes

| Mode | What is sent | What is spoken |
| --- | --- | --- |
| **Ask only** (default) | A frame only when you ask a question or press Describe now | Only answers to you |
| **Smart Explore** | A frame every few seconds | Only when the scene changes noticeably or something new appears (for example a person, door, stairs, sign or vehicle). Otherwise it stays quiet and shows "Last checked" with the time |
| **Continuous** | A frame every few seconds | Each new description, skipping near-identical repeats |

Smart and Continuous use more mobile data and more of the Meta AI allowance; this is explained in Settings and in the
consent dialog. Default mode, time between frames and session limit are set in Settings > Live Explore.

### Frame frequency and limits

- Time between automatic frames: **8, 12, 20 or 30 seconds** (default 8; 8 is the fastest allowed).
- Only **one request at a time**: the next frame is scheduled only after the previous answer arrives.
- Session limit: **5, 10 or 15 minutes** (default 10) and at most **60 frames**, then the session stops and says why.
- Frames are resized and compressed with the existing image preparation (max 1280 px, JPEG) and use brief descriptions.
- Errors: rate limited -> waits for the server's suggested time (default 60 s) before trying again; network or timeout ->
  retries, and stops after **3 failures in a row**; setup or sign-in problems -> stops at once. Every error is shown and
  spoken in plain words.
- The session stops when OpenEyes leaves the screen (tab hidden, app backgrounded, screen locked) or the Explore page
  is closed.
- Server allowance: **90 requests per 10 minutes** per device (raised from 30 in Phase 3 so a session at 8 s still leaves
  room for questions).

### Spoken responses

- Answers are spoken automatically with the **browser's built-in device voices** (Web Speech API). These are not
  neural or Meta voices.
- Pause speech, Resume speech, Stop speech, speech rate and voice choice are available on the Explore screen
  ("Speech options") and in Settings.
- Everything said appears in a text **Transcript**, with a "Based on:" line ("Current camera view", "Earlier camera view
  from 10:42", "plus 2 saved memories"). The transcript is kept only for the session and is not saved.
- With a screen reader, each message is either spoken by OpenEyes or announced to the screen reader, never both, so
  TalkBack does not read it twice.

### Voice commands and interruption

Press the large **Talk to OpenEyes** button (or type in "Type a question or command"). Pressing it **stops any speech
first, then listens**; OpenEyes never listens while it is speaking. This is tap-to-talk, **not true hands-free barge-in**.

| Say | What happens |
| --- | --- |
| "Stop" | Stops exploring and turns the camera off |
| "Pause" / "Keep exploring" | Pauses or resumes automatic frames |
| "Describe that again" | Repeats the last answer (describes the view now if there is nothing to repeat) |
| "Explore what's around me" | Describes a fresh frame now |
| "Read that sign" | Reads text in a fresh frame (Meta text reading) |
| "Find my keys" | Looks for the item in a fresh frame (Meta object finding) |
| "Remember this" | Offers to save the last observation as a memory, **only after you confirm** |
| "What's on my left?", "What's in front of me?" and other current questions | Answered from a fresh frame |
| "What colour was the cup?" and other past-tense questions | Answered from the previous frame, plus up to 3 earlier observations labelled as possibly out of date, plus relevant saved memories |

Your questions always take priority: they cancel any automatic analysis in progress, and automatic descriptions are not
spoken while you are talking or waiting for an answer. If the camera is not on, OpenEyes says it needs Live Explore
started instead of pretending to answer.

### Architecture

```
LiveExplorePanel (UI, buttons, badge, transcript, speech controls, dialogs)
  -> useLiveExplore (camera stream, speech, commands, transcript, visibility/unmount cleanup)
       -> liveExploreController (timer, one request at a time, pause, limits, backoff, priority for user requests)
       -> descriptionManager (word-overlap similarity, "something new appeared" detection)
       -> exploreCommands (turns what you say into a command)
       -> existing Meta providers -> openeyes-ai server function -> Meta Muse Spark
```

- Code: `src/services/explore/`, `src/hooks/useLiveExplore.ts`, `src/components/explore/`, `src/components/VoiceSelect.tsx`.
- Meta API usage is unchanged from Phase 2: the same `openeyes-ai` server function and tasks (`describe` for scene
  frames, `chat` for questions, `read` for signs, `find` for objects), model `muse-spark-1.3`, key kept on the server.

### Privacy (Live Explore)

- Only selected frames are sent to Meta AI through the OpenEyes server; the camera is never streamed as video.
- Frames are not stored on the server or in the browser. At most the last 5 frames are kept in memory for "what was..."
  questions and are released when exploring stops.
- Images and API keys are never logged. The transcript is not saved.
- Live Explore requires the one-time consent dialog; camera permission is requested only when you press Start.

### Safety limitations

- OpenEyes is **not a mobility aid** and does not replace a cane, guide dog or your own judgement.
- It does **not measure distances**. Directions such as "left" and "right" are relative to the **camera**, not your body.
- Answers state uncertainty; AI can miss or misdescribe things, and a description can be several seconds old by the
  time it is spoken.

### Android browser limitations

- Speech recognition in Chrome on Android may use Google's online speech service and needs a connection.
- The list of device voices can load late; the voice menu refreshes when opened.
- Browsers pause the camera in the background, so Live Explore stops on purpose when the screen locks or you switch apps.
- Speech timing and TalkBack interplay vary between phones and Android versions.
- No true barge-in: you must tap the mic button to interrupt.

### Remaining real-device testing

- TalkBack behaviour across the whole Live Explore flow (no double speech, focus, badge announcements)
- Android Chrome speech recognition and device voices, voice selection, speech rate
- Frame timing, mobile data use and the server allowance on real networks
- Camera release when switching apps, locking the screen and leaving the page
- Answer quality and latency of Muse Spark on real scenes

## Voice conversation (Phase 4)

**Status:** built and covered by automated tests. **Not yet tested on a real Android phone**, so how well hands-free
turns, the wake phrase and voice interruption work in practice is unknown.

### Using it

1. On Explore, tap **Start Voice Conversation**. The first time, a dialog explains how the microphone is used.
2. The browser asks for microphone permission. OpenEyes says "Voice conversation started. Microphone on."
3. Speak. OpenEyes answers aloud, then **listens again by itself** (hands-free turns, on by default).
4. To end: say "stop conversation", "goodbye" or "that's all", or tap **Stop conversation**. Leaving the screen,
   switching apps and the 15-minute limit also end it. A spoken message confirms the microphone is off.

It works with or without Live Explore:

- **With Live Explore running**, "What's in front of me?" sends a fresh frame. Follow-ups such as "What color is the
  bottle?" include the last few exchanges as context, clearly labelled so earlier views are not presented as current.
- **With the camera off**, questions are answered from the conversation only. The answer is labelled "Conversation only,
  camera off", and Meta AI is told it cannot see anything, so it should not describe the surroundings. Say "start
  exploring" to turn on the camera; the existing consent dialog still applies.

The **Talk** button is always available. It stops speech, cancels an answer still being prepared and listens straight
away. Typed questions also go through the conversation. All Live Explore commands (explore, what's on my left, describe
the table, read the label, find my keys, keep exploring, pause, stop exploring, remember this) work by voice.

### Settings (Settings > Voice conversation)

| Setting | Default | What it does |
| --- | --- | --- |
| Hands-free turns | On | Listen again after each reply. Off means tap Talk for every question. |
| Wake phrase "Hey OpenEyes" (experimental) | Off | Only respond to requests that start with "Hey OpenEyes", except for 8 seconds after a reply. Only works during a conversation you started. |
| Interrupt by voice (experimental) | Off | Keep listening while OpenEyes speaks so you can talk over it. Works best with headphones. |
| Show voice timing details | Off | Shows recognition, reply, speech start and end-to-end times for the last turn. No words or audio. |

Speech rate, voice choice, "Speak assistant replies" and Quiet mode still apply. With spoken replies off, answers go to
the screen reader and OpenEyes waits an estimated reading time before listening again.

### Architecture

- **Conversation engine** (`services/voice/voiceConversationEngine.ts`): owns the session. States are idle, starting,
  listening, user-speaking, processing, assistant-speaking, interrupted, waiting (tap-to-talk), error and stopped.
  Transitions are checked against a fixed table (`conversationStateMachine.ts`) and invalid ones are refused.
- **One speaker owner:** while a conversation runs, all Live Explore speech goes through the engine, so only one
  utterance plays at a time. A new utterance cancels the old one, and an id check stops a cancelled utterance from
  restarting listening.
- **Stale answers:** every turn has an id and an AbortController. Interrupting, typing, stopping or a newer turn aborts
  the request (including the Live Explore task) and the old answer is never spoken.
- **Camera and voice coordination:** user requests go through Live Explore's single-request queue, which cancels any
  automatic description in progress. Automatic descriptions are only spoken while OpenEyes is idle (listening or waiting),
  never while you are speaking or an answer is coming. They continue only if Smart Explore or Continuous mode is on.
- **Listening loop:** Android Chrome's speech recognition stops after each phrase, so the engine restarts it. After 3
  silent rounds (each one plays the Android tone) it switches to tap-to-talk and says so. After 2 recognition errors in a
  row it says hands-free listening is unreliable and stays in tap-to-talk for the rest of the session.
- **Short-term memory:** the last 8 messages are kept in memory only and cleared when the conversation or Live Explore
  ends. Saved memories still need the existing confirmation dialog; nothing is saved automatically.
- **Diagnostics:** per-turn timings only, no transcript.

### Voice providers

| Part | Provider in use | Notes |
| --- | --- | --- |
| Speech recognition | **Meta Muse Voice Transcribe** (default) through the `openeyes-voice` relay | Falls back to the browser Web Speech API automatically, or by choice in Settings. |
| Speech output | Browser SpeechSynthesis | Default and fallback. |
| Natural voice | **None connected** | `NeuralTTSProvider` interface (`types/tts.ts`) and player (`neuralSpeechPlayer.ts`) are ready. `Services.neuralTTS` is `null`. If a provider is added and fails, that sentence falls back to the browser voice. |

The interface covers synthesis, playback, cancellation, voice listing, error kinds, an optional streaming method and
configuration. Any provider must be called **through the OpenEyes server** so its key never reaches the browser.

### Natural voice research (not connected)

Meta does not offer a text-to-speech model; Meta's models page states that Muse Voice Transcribe does not synthesize
speech. These are candidates. Prices are list prices reported in October 2026, some from secondary sources, so check
the official pricing pages before choosing.

| Provider | Quality and features | Streaming | Reported price | Docs |
| --- | --- | --- | --- | --- |
| Google Cloud Text-to-Speech | Standard, WaveNet, Neural2, Chirp 3 HD voices; SSML | Yes (Chirp 3 HD) | $4-$30 per 1M characters by voice type, free monthly tier | https://cloud.google.com/text-to-speech/pricing |
| Microsoft Azure AI Speech | Neural and Neural HD voices, SSML, many languages | Yes | About $15-$16 per 1M characters for neural voices, free tier | https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/ |
| Amazon Polly | Standard, Neural, Generative, Long-Form | Yes | $4 / $16 / $30 / $100 per 1M characters | https://aws.amazon.com/polly/pricing/ |
| OpenAI gpt-4o-mini-tts | Steerable speaking style, 2,000 input tokens per request | Yes | $0.60 per 1M input tokens plus $12 per 1M audio output tokens | https://developers.openai.com/api/docs/models/gpt-4o-mini-tts |
| ElevenLabs | Very natural voices; Flash v2.5 about 75 ms model latency | Yes (HTTP and WebSocket) | About $40 per 1M characters on Flash v2.5 | https://elevenlabs.io/docs/overview/models |

All of them need an API key held on the server, and they return audio (MP3, Opus or PCM) that every modern browser,
including Android Chrome, can play. Streaming would need a server function that passes audio chunks through; the player
currently plays a complete clip.

### Meta Muse Voice Transcribe evaluation

Source: https://dev.meta.ai/docs/speech-to-text (model `muse-voice-transcribe-1.0`).

- **Realtime:** WebSocket `wss://api.meta.ai/v1/asr/realtime`. **The API key is sent inside the first message**, not a
  header. Audio must be raw 16-bit mono PCM at 16 or 24 kHz, sent at real-time pace, with silence during pauses.
  Endpointing mode gives voice activity and turn detection (`speechStart`, partial `transcript`, `speechEnd`,
  `speechComplete`). Sessions last up to 60 minutes.
- **File:** `POST /v1/asr/transcribe` with a WAV file (up to 32 MB or 10 minutes); 429 on rate limits.
- **Price and limits:** $0.18 per hour of audio; failed and rate-limited requests are not billed; 25 languages; keyword
  biasing; no word timestamps.
- **Phase 4 decision (superseded in Phase 4.1, see below):** not connected. A browser cannot open the realtime socket without exposing `MODEL_API_KEY`.
  Doing it securely needs a server relay that holds the key and forwards audio. Whether Supabase Edge Functions can keep
  a long-lived two-way WebSocket open to Meta at real-time pace has not been verified, and the browser would also need
  to capture and convert raw PCM (AudioWorklet). The file endpoint could work through the existing function, but it adds
  a full upload per turn and gives no live turn detection.
- **Plan:** (1) build and measure a relay prototype (edge function or the planned native app); (2) capture 16 kHz PCM
  with an AudioWorklet and echo cancellation on; (3) use endpointing mode for turns; (4) apply the existing per-device
  quota to audio minutes; (5) keep Web Speech as the fallback.

### Privacy and security

- The microphone is only requested after you tap Start Voice Conversation and confirm the explanation. It never runs in
  the background. Every recognition session is aborted on stop, session limit, leaving the screen and page close; the
  permission check releases its microphone track immediately.
- OpenEyes does not record, store or log audio. With Meta Voice (default), microphone audio is streamed through the
  OpenEyes server to Meta only while listening; with the browser option, the browser turns speech into text (possibly
  on its maker's servers). The recognized text is sent to Meta AI through the OpenEyes server, which holds the key.
- Requests stay under the existing server quota (90 per 10 minutes per device). Sessions end after 15 minutes.
- Short-term conversation context is held in memory only and never saved.

### Safety

Voice conversation is not a mobility aid. It uses the same server safety rules as the rest of OpenEyes: no road-crossing
or obstacle-avoidance guidance, uncertainty stated plainly, no invented details. With the camera off, Meta AI is told
it cannot see.

### Android and browser limitations

- Speech recognition stops after each phrase; OpenEyes restarts it, and Android plays a tone each time.
- Recognition may stop working without warning or need a network connection; OpenEyes then switches to tap-to-talk.
- Echo cancellation in the browser is not reliable for its own speech output, so voice interruption may hear OpenEyes
  itself. A text filter ignores phrases OpenEyes just said, but it is not perfect. Headphones help.
- TalkBack: the state text is not announced on every change, to avoid the screen reader talking over the microphone.
  Start, stop, tap-to-talk switches and errors are always spoken.
- Firefox has no speech recognition; the Start Voice Conversation button is disabled with an explanation.

### Remaining real-device testing

- Hands-free turns on Android Chrome with TalkBack on and off, with and without headphones.
- How often recognition restarts fail, and how annoying the Android tone is in practice.
- Voice interruption and the echo filter on the phone speaker.
- Wake phrase recognition accuracy.
- Real latency figures from the timing details.
- The microphone indicator turning off after stop, leaving the app and locking the screen.

## Phase 4.1: Meta Voice Transcribe and hands-free fix

### The Android listening bug

**Symptom:** after each spoken answer, the user had to tap the microphone again.

**Cause (from the code):** hands-free listening restarted only from the speech synthesis `onend` event. Android Chrome
often drops `onend` (and sometimes `onstart`), especially for long utterances or utterances that were not kept
referenced and were garbage-collected. With no other signal, the conversation stayed in "OpenEyes speaking" forever.

**Fix (`browserSpeechPlayback.ts`):**

- Replies are split into short chunks (max 180 characters, on sentence boundaries), each held in memory until done.
- A monitor polls `speechSynthesis.speaking / pending / paused` every 250 ms. A chunk counts as finished when the real
  `end` event arrives, **or** when it was seen speaking and then the engine is quiet for 3 polls in a row.
- A silent engine is **not** assumed to mean success: if a chunk never starts within 2.5 s it is retried once, then
  skipped. Only the last chunk finishing ends the reply.
- **Long replies:** there is no fixed timeout. The stuck-speech guard fires only after 3x the estimated chunk duration
  plus 8 seconds, per chunk, so long descriptions are never cut off.
- **Paused speech** is never treated as finished; paused time is excluded from the stuck guard, and if Android drops the
  speech while paused, resume replays the chunk.
- Stop and newer speech cancel the monitor, so a stopped conversation can never be restarted by a late event.
  Conversation callbacks are also guarded by per-listen and per-utterance ids.

### Meta Muse Voice Transcribe (verified)

Facts used, from https://dev.meta.ai/docs/speech-to-text:

| Item | Value |
| --- | --- |
| Endpoint | `wss://api.meta.ai/v1/asr/realtime` |
| Model | `muse-voice-transcribe-1.0` |
| Authentication | first JSON frame `{"authorization":{"accessToken":"Bearer <key>"}, ...}` (headers are ignored) |
| Audio | binary 16-bit little-endian mono PCM, `PCM_16KHZ`, sent at real-time pace |
| Mode | `ENDPOINTING` (Meta detects turns), `partialMode: CUMULATIVE` |
| Events | handshake ack (`sessionId`), `speechStart`, `transcript` (partials), `speechEnd`, `speechComplete` (final), `error` |
| End | `{"type":"endStream"}`, server closes with 1000 |

**Live verification (real requests through the deployed relay, not mocks):**

- 2 s of silence: ticket issued, Meta handshake acknowledged, clean close (code 1000), ticket reuse refused.
- Spoken test clip "What's on the table in front of me?": partial transcripts word by word, `speechStart`, `speechEnd`,
  then `speechComplete: "What's on the table in front of me?"`, close 1000 after about 6 s, ticket reuse refused.
- Repeat with `node --env-file=.env scripts/voice-live-check.mjs [16 kHz raw PCM file]`.

### Relay architecture

```
Browser mic -> AudioWorklet (16 kHz PCM, 80 ms frames)
  -> POST /functions/v1/openeyes-voice  (public app key)  -> single-use ticket (30 s)
  -> WSS  /functions/v1/openeyes-voice?ticket=...         -> Supabase Edge Function
       -> wss://api.meta.ai/v1/asr/realtime  (MODEL_API_KEY in the server-side handshake only)
  <- ready / speechStart / transcript / speechEnd / speechComplete / error / closed
```

- One relay connection per listening turn. The microphone and the connection are closed while OpenEyes speaks, so
  OpenEyes cannot transcribe its own replies (unless experimental voice interruption is on).
- Only `speechComplete` is submitted as a question; partial words are only displayed.
- Supabase Edge Functions supported the two-way WebSocket relay in testing, so no extra hosting was needed.

### Browser fallback

Settings > Voice conversation > Speech recognition: **Meta Voice** (default) or **Browser**. With Meta Voice, if the
relay is unreachable, refuses a ticket (401, 429, 503), times out or drops, the same question is finished with the
browser recognizer and a notice is shown and spoken. After 2 failures the browser is used for the rest of the
conversation. The active recognizer is shown under the conversation status.

### Security and cost controls

- `MODEL_API_KEY` stays in the edge function; it is never in browser code, URLs or storage.
- Tickets: random 256-bit, stored only as a SHA-256 hash, valid 30 s, single use (`voice_session_tickets`, RLS on, no
  client access; functions callable only by the server).
- Limits per client address (hashed): 60 tickets per 10 minutes and 20 minutes of audio per hour; 429 with Retry-After.
- Per connection: 60 s maximum, 10 s handshake timeout, frames up to 200 ms, audio no more than 3 s ahead of real time,
  4 s pre-ready buffer. Violations close the connection.
- Ticket requests must carry this project's public app key.
- No audio or transcripts are stored or logged; the server logs only audio duration and outcome. Meta error details are
  not passed to the browser.

### Still to test on a real Android phone

1. Start Voice Conversation, ask "What's around me?", wait for the full answer, then ask "What's on my left?" without
   tapping. Repeat with a long description (over 30 seconds of speech).
2. Pause and resume during speech (if the system interrupts), and Stop conversation during speech: the microphone
   indicator must turn off and listening must not resume.
3. Meta Voice latency (timing details: First words, Final words, Speech length, Listening again).
4. Fallback: turn off mobile data during listening; the browser should take over with a notice.
5. TalkBack on and off, phone speaker and headphones.
6. Microphone indicator after stop, leaving the app and locking the screen.

## App updates and caching (v0.4.2)

### Why older versions stayed visible

OpenEyes has no service worker, no PWA manifest and never used Cache Storage, so no offline cache was holding old
files. JavaScript and CSS files carry a content hash in their names (`/assets/index-<hash>.js`), so a new build always
uses new file names. The stale copy is `index.html` itself: without an explicit `Cache-Control` header, Chrome and
CDNs may reuse a cached copy heuristically, and that old page keeps pointing at the old hashed files. The live
response headers of the published site have not been inspected yet, so this is the most likely cause, not a confirmed one.

### Version detection

- `vite.config.ts` contains a small plugin (`openeyes-build-info`). Each build creates `{ version, buildId, builtAt }`:
  the version comes from `package.json` at build time, the build id is a timestamp plus random suffix, unique per build.
- The same object is compiled into the app as `__APP_BUILD__` (read through `src/services/updates/buildInfo.ts`) and
  written to `dist/version.json`. Both always come from the same build, so nothing is hard-coded or read from
  `package.json` at runtime. The dev server also answers `/version.json`.
- A check requests `/version.json?t=<now>` with `cache: 'no-store'` and a 10 second timeout, validates the response,
  and compares build ids (`src/services/updates/updateChecker.ts`). Offline, timeout, HTTP error, network error and an
  unreadable response (for example the HTML fallback page when the file is missing) all report **Could not check**;
  a failed check never reports "Up to date".
- Automatic checks: at start-up, when the app returns to the foreground, when the connection comes back, and every
  30 minutes while visible; never more than once per 5 minutes automatically.

### Update notice and safe update

- When a new build is found, a notice says "A new version of OpenEyes AI is available." with **Update now** and
  **Later**, and the message is spoken through the screen reader live region.
- The notice is held back while Live Explore, a voice conversation or listening is running, and nothing ever reloads
  without confirmation.
- Update now explains the reload in a confirmation dialog, then stops registered features (Live Explore, voice
  conversation including the Meta Voice relay connection, listening, camera, pending Meta AI requests), cancels
  speech, clears cached app files and reloads the same route with a one-time `_oe_refresh` query so the browser and CDN
  must fetch a fresh page. The query is removed from the address straight after start-up.
- After the reload, a sessionStorage record confirms whether the build id changed. If not, a clear error appears with
  Try again. After two failed attempts within 10 minutes, further reloads are refused and manual steps are shown, so
  reload loops cannot happen. Start-up never reloads on its own.

### Clear cache & reload

Confirmation text: "Clear cached app files and reload OpenEyes AI? Your memories, trusted contacts, and personal
settings will be kept." It deletes this site's Cache Storage entries (the browser only exposes this site's caches)
and unregisters any service worker registered on this origin (OpenEyes ships none, so any found is a leftover), then
reloads as above. localStorage (memories, contacts, settings, conversation, consents) and IndexedDB are never touched.
JavaScript cannot clear Chrome's HTTP cache, so this works by forcing a fresh page request rather than wiping it.

### Hosting cache configuration

`public/_headers` (copied to `dist/_headers`) uses the same Netlify-style convention as the `_redirects` file Bolt
hosting already generates: `index.html` and app routes `no-cache`, `version.json` `no-store`, `/assets/*`
`public, max-age=31536000, immutable`. Bolt's documentation does not say whether `_headers` is honoured. **Unverified:**
after publishing, inspect the response headers of the site and `/version.json`. The update check works either way,
because it bypasses the cache with `no-store` and a unique query.

### Manual refresh (also shown in Settings)

- Android Chrome: Chrome menu (three dots), Reload. If still old, close Chrome from recent apps and reopen.
- Installed app: close it from recent apps and reopen.
- Desktop Chrome: Ctrl+Shift+R (Cmd+Shift+R on Mac).
- Last resort: Chrome Settings, Privacy and security, Delete browsing data, **Cached images and files only**. Choosing
  cookies and site data deletes memories, contacts and settings.

### Known limitations

- Not yet verified on a real Android phone or installed PWA.
- Whether Bolt hosting applies `_headers` is unknown.
- A CDN may still serve an old `index.html` for its own cache lifetime; the version check itself is not affected.
- Without sessionStorage the reload still works but cannot be verified afterwards.

## Meta AI integration (Phase 2)

### Verified against official Meta documentation

Source: Meta Model API docs at `dev.meta.ai/docs` (overview, models, file handling).

| Item | Value used |
| --- | --- |
| Base URL | `https://api.meta.ai/v1` |
| Endpoint | `POST /v1/chat/completions` (OpenAI-compatible Chat Completions) |
| Authentication | `Authorization: Bearer <MODEL_API_KEY>` |
| Model | `muse-spark-1.3` (default; override with `META_MODEL_ID`). The `-contributor` variants are **not** used because they allow Meta to train on submitted data |
| Image input | Content part `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}` |
| Output limit | `max_completion_tokens` 2048 (4096 for text reading) |

Not used / not invented: SAM 3.1 (`sam-3.1`, Responses API) is documented by Meta but **not integrated**. The Find result
type already has an empty `matches` array ready for its boxes and masks. Muse Voice Transcribe is not integrated.

### Architecture

```
Browser (React)                      OpenEyes server function                    Meta Model API
-----------------                    ------------------------------              ----------------
Explore / Find / Read / Assistant -> supabase/functions/openeyes-ai  ---------->  POST /v1/chat/completions
  VisionProvider, ObjectDetection     - validates task, image, sizes                (Muse Spark)
  Provider, AIProvider (Meta impl)    - per-device rate limit (Postgres)
  - resizes photo to max 1280px       - builds safety-first prompts
    JPEG ~80%, max 4 MB               - holds MODEL_API_KEY (never sent to browser)
  - 60 s timeout, Cancel              - 45 s timeout, maps Meta errors
```

- `src/services/ai/metaProviders.ts` implements the existing `AIProvider`, `VisionProvider` and
  `ObjectDetectionProvider` interfaces. `ServicesContext` uses them when the app has the public server address, otherwise
  the Phase 1 "unavailable" providers. Screens did not change their provider contracts.
- `src/services/ai/openEyesBackend.ts` is the only code that calls the server. It maps every failure to a typed
  `AIRequestError` (`not-configured`, `auth`, `rate-limited`, `timeout`, `network`, `unsupported-image`,
  `image-too-large`, `rejected`, `bad-response`, `server`, `cancelled`) with a plain-language message.
- `src/services/ai/imagePreparation.ts` validates (JPEG, PNG, WebP, GIF; max 15 MB source), resizes and re-encodes to JPEG.
  The encoded photo is cached per photo, so asking several questions about one photo does not re-encode it.
- `src/services/ai/conversationContext.ts` keeps the last 10 messages, detects "Remember that..." requests and selects up
  to 5 relevant saved memories by keyword overlap.
- `supabase/functions/openeyes-ai/core.ts` holds all server logic in runtime-neutral TypeScript so it is unit tested;
  `index.ts` only wires in environment variables and the rate-limit database call.
- Database: table `ai_request_log` and function `consume_ai_quota` (90 requests per 10 minutes per hashed client IP since Phase 3; 30 in Phase 2).
  Row level security is on with no client policies; only the server role can use them.

### Environment variables

| Name | Where | Secret | Purpose |
| --- | --- | --- | --- |
| `MODEL_API_KEY` | Supabase Edge Function secrets | **Yes** | Meta Model API key. **Configured.** |
| `META_MODEL_ID` | Supabase Edge Function secrets | No | Optional model override, default `muse-spark-1.3` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided automatically to the function | Yes | Rate-limit database access |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Frontend `.env` | No (public) | Address of the server function and the public app key |

Never put the Meta key in a `VITE_*` variable: those are bundled into the browser code.

### Backend setup

1. Create a Meta Model API key at the Meta developer portal.
2. Add it as an Edge Function secret named `MODEL_API_KEY` for this project (Bolt: project settings > Secrets /
   Supabase dashboard: Edge Functions > Secrets). Optionally add `META_MODEL_ID`.
3. The `openeyes-ai` function is already deployed. Open Settings > Meta AI models > **Check Meta AI connection**; it
   reports "Server ready" once the key is present. Then try Explore > Describe to make a first real request.

### Safety and privacy behaviour

- Photos are processed **only** when the user presses Describe, Find, Read, or Send with a photo attached, or while a
  Live Explore session the user started is running (see [Privacy (Live Explore)](#privacy-live-explore)). The camera is
  never streamed as video. Photos and frames are not stored by OpenEyes.
- Prompts instruct the model to describe only what is visible, state uncertainty, use relative positions only (no
  distances), never judge whether something is safe and never give navigation directions, and not identify people.
- Every result shows a note that AI can be wrong and does not replace a cane, guide dog or the user's own judgement.
- The Assistant tells the model how old the attached photo is and labels memories as "saved notes, not current
  observations". Without a photo, the model is told it cannot see anything right now.
- "Remember that..." never saves automatically: a confirmation dialog must be accepted. Camera observations are never
  saved automatically.
- Long answers are never spoken automatically (only replies of 300 characters or fewer, when spoken replies are on).
  Read aloud, Pause, Resume and Stop are always available.

## Phases 5-7: Find, Read, Memory, Daily Assistance, Environmental Awareness (v0.5.0)

Everything below uses the existing Meta Muse Spark connection through the `openeyes-ai` server function. No new AI
model was added. SAM 3.1 or other Meta detection or segmentation models were not used, because official API access
was not confirmed. Positions are described in words only.

### Advanced Find

- A live search session ("Start live search for keys") checks one camera frame at a time at a controlled rate, never
  sends overlapping requests, and pauses after a round of frames to limit usage. "Keep looking" continues; "Stop
  search" ends the session and turns the camera off.
- Answers use camera-relative wording ("on the table, near the laptop"). Uncertain answers say "I may see your keys,
  but I can't confirm from this angle." It never says an item is reachable or safe to approach.
- "Remember this location" saves only after confirmation. Remembered locations are always labelled as something the
  user said earlier, not something the camera sees now.

### Advanced Read

- Quick Read, Full Read, Ask About Text (answers labelled as exact text, summary, inference or not found) and Read
  Again. Follow-up questions use the same captured document until a new scan or Clear reading session.
- Extracted text is kept separate from summaries; blurry photos are reported as unreadable. Document images are not
  stored and document contents are not logged.

### Personal memory

- Categories: notes, object locations, preferences, accessibility preferences, routines, reminders, frequently used
  information. Nothing is saved without confirmation.
- "Remember that I prefer short descriptions" switches to brief answers only after confirmation. "Remember that my
  glasses are in the bedroom drawer" asks "Would you like me to remember that location?" and replies "Saved."
- "Where are my glasses?" answers from saved locations and suggests checking with the camera. Only relevant memories
  are sent to Meta AI.
- Memory screen: category filter, labels, mark reminders done, Export memories (JSON), Clear all memories with
  confirmation. Older memories without a category show as notes; nothing is rewritten.
- Memories stay in this browser's local storage, not encrypted beyond what the browser provides.

### Daily assistance

- "Help me make coffee" offers a guided task; after "yes", Meta AI writes up to 12 short steps. "Next", "Repeat",
  "Go back", "Pause", "Resume" and "Stop" work by voice, typing or buttons. Steps never advance by themselves, and
  OpenEyes says it cannot see the user doing them. A paused task survives a reload.
- "Remind me to call John tomorrow" saves a reminder record after confirmation. **Reminders do not alert you**; there
  is no notification or background scheduling, and the app says so.

### Environmental awareness (experimental, not a mobility aid)

- Off by default. Settings > Environmental awareness: enable, pause, frequency (rarely by default), detail (brief by
  default), categories (people, doors, stairs by default).
- When on, Live Explore compares automatic frames and may announce one descriptive change ("The door appears open.").
  Low-confidence changes, repeats, unchosen categories and announcements too close together are skipped. User
  questions come first.
- A safety filter removes wording such as "the path is clear", "safe to cross", "no obstacles", "walk forward", turn
  directions, and speed or approach claims; Meta AI is also told never to produce them.
- Recent observations are kept in memory for 3 minutes per camera session, then forgotten, and never become saved
  memories. It does not replace a white cane, guide dog or orientation and mobility training.

### Working together

- The Assistant routes clear requests by rule: "Find my keys" opens Find with "keys" filled in, "Read this" opens
  Read, "What's around me?" opens Live Explore, "Remember..." asks to save, "Help me..." offers a guided task.
  Everything else goes to Meta AI as before.
- In Live Explore, "Remember that my keys are on this table" asks for consent and accepts a spoken "yes" or "no".
- The existing microphone, Meta Voice relay, browser fallback and speech output are reused. User answers interrupt;
  errors are spoken; automatic descriptions and scene announcements never interrupt speech or a voice conversation.

## Placeholders (not functional yet)

- **SAM 3.1 segmentation** (exact object outlines). Find uses Muse Spark's description of position instead.
- **Muse Voice Transcribe.** Evaluated in Phase 4 but not connected; voice input uses the browser speech service.
- **Natural (neural) voices.** The interface is ready, but no voice service is connected; the browser voice is used.
- **Meta glasses connection.** The Connect button never shows a fake success.
- **Proactive assistance** beyond Live Explore. Smart Explore only speaks during a session you start; there is no background monitoring.

## Planned features (not started)

- SAM 3.1 integration for Find
- Muse Voice Transcribe for voice input through a secure server relay (see the evaluation above)
- A connected natural voice provider behind the existing interface
- Native Android app (Kotlin) using the official Meta Wearables Device Access Toolkit, hosting this UI
- Reliable hands-free interruption (needs echo-safe audio capture, likely in the native app)

See [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md) for the Android requirements.

## Project structure

```
src/
  App.tsx                 routes (all except Home are lazy-loaded)
  main.tsx                entry; builds the default service set
  components/             accessible building blocks (Dialog, Notice, CameraCapture, PhotoAttachment, AIResult, FindResultCard, MetaConnectionCheck, VoiceSelect, ...)
    explore/              Live Explore panel, transcript, speech controls
  pages/                  one file per section
  hooks/                  useSettings, useAnnouncer, useCamera, useAIRequest, useLiveExplore, useSpeechRecognition, useSpeechSynthesis, ...
  services/
    ServicesContext.tsx   dependency injection of every provider (swapped in tests)
    ai/                   Meta providers, backend client, image preparation, conversation context, model catalog, unavailable providers
    explore/              Live Explore controller, description manager, command parser
    voice/ camera/ devices/ memory/ settings/ storage/
  types/                  provider interfaces
supabase/
  functions/openeyes-ai/  server function: index.ts (Deno entry), core.ts (logic, tested)
```

## Data storage

Settings (including Live Explore defaults and the one-time Live Explore consent), memories, contacts and (optionally) the conversation are stored **only in this browser's `localStorage`**
under keys prefixed with `openeyes.`. The server stores only a one-way hash of the client IP address and a time stamp
for rate limiting; these rows are deleted after one day. Photos, camera frames and messages are not stored on the server.
The Live Explore transcript and frames are kept in memory only and disappear when the session ends.

## Accessibility considerations

- Semantic landmarks, one `h1` per screen, skip link; focus moves to the page heading on navigation
- Live Explore: text camera badge (no colour-only status), each message spoken or announced but never both, transcript as a plain list (not re-announced), large Talk to OpenEyes button that stops speech before listening
- Polite and assertive live regions: "Describing your photo...", results, errors and cancellations are announced
- Every AI request has a visible Cancel button; results are text first, with optional speech
- Every control has an accessible name; icons are hidden from assistive technology
- Touch targets at least 48 x 48 px; four text sizes; dark, light and high-contrast themes; reduce motion
- Modal dialogs: focus trap, Escape to close, focus restoration
- Automated axe-core checks run in the test suite

Manual testing with TalkBack and VoiceOver on physical devices is still required.

## Security considerations

- The Meta API key exists only as a server secret. The browser holds only the public Supabase address and public app key.
- The server function requires the app key (`verify_jwt = true`), validates every field, limits image size (about
  5 MB of image data), message count and length, accepts only JPEG, PNG and WebP data, and rate limits per hashed IP.
- Server errors return generic messages; Meta error bodies are not passed to the browser.
- The rate-limit table has row level security with no client access; the quota function is callable only by the server role.
- User input is validated and length-limited; calls and emails require confirmation.
- `.env` is git-ignored. Do not commit secrets or personal data.

## Test results

v0.5.0 (Phases 5-7): `npm run typecheck` passes, `npm test` **360 tests passing in 25 files**, `npm run build`
succeeds. New test files: `advancedFind`, `advancedRead`, `advancedMemory`, `taskSessions`, `environmentalAwareness`,
`unifiedExperience`, plus new server cases in `edgeFunction`. One older test was changed on purpose: "Where are my
keys" is now answered from saved memories, so the "could not answer" check uses a general question. They cover object
search, uncertainty, reading accuracy handling, document follow-ups, memory consent, retrieval and deletion, task
sessions, reminder limitations, scene context expiry, environmental announcements and the safety filter, intent
routing, cross-feature conversations, camera and microphone cleanup, and API failure recovery. These are **mocked
tests**; they do not prove real-world recognition or reading accuracy, and nothing was tested on a real Android phone.

v0.4.2: `npm run typecheck` passes, `npm test` **271 tests passing in 19 files** (238 from Phase 4.1, unchanged, plus
33 new in `appUpdates.test.tsx`), `npm run build` succeeds and emits `dist/version.json` and `dist/_headers`. New
tests cover version display, manifest request without HTTP cache, build id comparison, update detection, every check
failure, cache deletion, personal data preservation, service worker handling, browsers without Cache Storage or
service workers, session cleanup before reload, confirmation and cancel, same-route reload, verification after reload
and reload-loop prevention.

Phase 4.1 (v0.4.1): `npm run typecheck` passes, `npm test` **238 tests passing in 18 files** (182 from Phase 4,
unchanged, plus 56 new), `npm run build` succeeds. New tests cover: Android-style speech lifecycle (lost `onend`, lost
`onstart`, never starting, long chunked replies not cut off, pause not treated as finished, replay after a dropped
pause, stop leaving no timers, stale events ignored); the relay (documented handshake, buffering until Meta's ack,
event whitelist, key never sent to the browser, frame size, real-time pacing, duration limit, handshake timeout,
rejected and unreachable upstream, connection limit, cleanup on browser close); tickets and authentication (app key
and JWT claim checks, 401, 429 with Retry-After, 503 without leaking details, hashed tickets); the Meta Voice recognizer
(ticket in URL only, audio held until ready, partials shown but only `speechComplete` submitted, empty turns, no-speech,
stop and abort with microphone cleanup, ticket errors, dropped connections, connection timeout, permission errors);
browser fallback (same-turn fallback, session fallback after 2 failures, no fallback for silence, none after cancel);
PCM resampling; two hands-free turns without a tap; no duplicate microphone sessions; stop during speech; the Talk
button; timing metrics without words; the recognition setting. These are **mocked tests**. Separately, **real Meta
Voice requests through the deployed relay succeeded** (see Phase 4.1). Nothing has been verified on a real Android
phone yet.

Phase 4 (v0.4.0): `npm run typecheck` passes, `npm test` **182 tests passing in 15 files** (the 148 from Phases 1-3,
unchanged, plus 34 new), `npm run build` succeeds. The new tests use fake speech recognition, a fake voice, fake timers
and mocked Meta responses, so they **do not prove behaviour on a real phone, microphone or speaker**. They cover: state
transitions and invalid transitions, microphone permission and its denial, unsupported browsers, the hands-free next
turn, tap-to-talk mode, silent rounds and repeated recognition errors falling back to tap-to-talk, permission revoked
mid-session, manual interruption, experimental voice interruption with echo filtering, stale answers never spoken,
late recognition results ignored, automatic descriptions held back while busy, wake phrase handling, session limit,
cleanup on stop and on leaving the page, short-term follow-up context, camera-off answers, typed input during a
conversation, natural voice playback, cancellation and fallback, settings validation, and an accessibility scan.

Phase 3 (v0.3.0): `npm run typecheck` passes, `npm test` **148 tests passing in 11 files** (106 from Phases 1-2,
unchanged, plus 42 new), `npm run build` succeeds. The new tests use fake timers, a fake camera and mocked Meta
responses, so they **do not prove real Meta connectivity or real-device behaviour**. They cover: frame interval and
minimum interval, no overlapping requests, pause and resume, stop cancelling the request and releasing frames, Ask only
mode, duplicate suppression, bounded history, rate-limit backoff, repeated network failures, frame and time limits,
user questions taking priority, change detection, command parsing, consent dialog, camera indicator and spoken
confirmations, permission denial, current vs. earlier-view questions, the mic stopping speech before listening, find and
read routing, pause/resume/stop by voice, leaving the screen, page cleanup, memory confirmation and an accessibility scan.

Phase 2: 106 tests (58 from Phase 1, 48 new) covering request format and bearer auth, invalid credentials, network
failure, timeout, cancellation, unsupported image type, size limits, server rate limits, missing key, object not found,
unreadable text, line breaks, conversation bounding, memory confirmation, memories as background, no automatic speech,
and UI flows on Explore, Find, Read and Assistant.

## Known limitations

- `MODEL_API_KEY` is configured and real answers were reported on Android by the project owner; Live Explore answer
  quality, latency and Meta's own rate limits have not been measured systematically.
- Voice conversation and Live Explore use browser voices (not neural). Hands-free turns depend on detecting the end of
  browser speech on Android, which is now monitored but not yet verified on a phone; voice interruption is experimental.
  Everything stops in the background.
- Meta Voice opens one relay connection per question, adding about 1-3 s of connection setup before Meta is ready
  (audio said during setup is buffered, not lost).
- Smart Explore change detection uses word overlap between descriptions, so it can miss small changes or repeat a
  scene described in different words.
- Find reports approximate positions in words only; it cannot measure distance and does not use SAM 3.1.
- Reminders are records only; they never alert you.
- Environmental awareness is experimental, works only during a Live Explore session you start, and is not a mobility aid.
- Guided task steps are written by Meta AI and can be wrong or incomplete.
- Memory relevance uses simple keyword matching.
- Speech recognition depends on browser support (Chrome/Edge yes, Firefox no) and follows the browser language.
- Data is per-browser and per-device; private browsing may discard it.
- Not yet tested manually with TalkBack or VoiceOver on physical devices.
