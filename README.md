# OpenEyes AI

**Your World, Understood.**

OpenEyes AI is a voice-first, accessibility-first personal assistant designed to help blind and low-vision people
understand their surroundings, find objects, read text, remember important information and accomplish everyday tasks
more independently. The long-term target is Android smartphones and compatible Meta AI glasses.

> Status: **Phase 3 (v0.3.0): Live Explore and interactive voice companion implemented.** On top of Phase 2 (scene
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

## Placeholders (not functional yet)

- **SAM 3.1 segmentation** (exact object outlines). Find uses Muse Spark's description of position instead.
- **Muse Voice Transcribe.** Voice input uses the browser speech service.
- **Meta glasses connection.** The Connect button never shows a fake success.
- **Proactive assistance** beyond Live Explore. Smart Explore only speaks during a session you start; there is no background monitoring.

## Planned features (Phase 4+, not started)

- SAM 3.1 integration for Find
- Muse Voice Transcribe for voice input
- Native Android app (Kotlin) using the official Meta Wearables Device Access Toolkit, hosting this UI
- True hands-free interruption (barge-in) and higher-quality voices

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
- Live Explore uses browser voices (not neural), tap-to-talk instead of true barge-in, and stops in the background.
- Smart Explore change detection uses word overlap between descriptions, so it can miss small changes or repeat a
  scene described in different words.
- Find reports approximate positions in words only; it cannot measure distance and does not use SAM 3.1 yet.
- Memory relevance uses simple keyword matching.
- Speech recognition depends on browser support (Chrome/Edge yes, Firefox no) and follows the browser language.
- Data is per-browser and per-device; private browsing may discard it.
- Not yet tested manually with TalkBack or VoiceOver on physical devices.
