# OpenEyes AI

**Your World, Understood.**

OpenEyes AI is a voice-first, accessibility-first personal assistant designed to help blind and low-vision people
understand their surroundings, find objects, read text, remember important information and accomplish everyday tasks
more independently. The long-term target is Android smartphones and compatible Meta AI glasses.

> Status: **Phase 2 (v0.2.0): Meta AI visual intelligence implemented.** Scene description, object finding, text
> reading and contextual conversation are wired to Meta's **Muse Spark** model through a secure OpenEyes server function.
> **The Meta API key has not been added to the server yet, so no real Meta request has been verified.** Until it is,
> every AI action shows a clear "not set up yet" message instead of an answer. **Meta glasses cannot be connected yet.**

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
| Explore | Phone camera capture, then **Describe my surroundings** (Muse Spark). Result shown as text with Read aloud / Pause / Stop controls and a safety note |
| Find | Item name by typing or voice, camera capture, then **Find** (Muse Spark): visible / not seen / not sure, relative position, confidence, next-step suggestion. Saved memories shown separately and labelled as past notes |
| Read | Camera capture or photo upload, **Read text from photo** (Muse Spark) fills the read-aloud box with line breaks kept; "No readable text found" when nothing is readable; paste/type text; read aloud with the device voice |
| Memory | Save (explicit action only), view, edit, delete (with confirmation), search; dictate a memory by voice |
| Devices | Phone camera and microphone availability and permission state; Meta Glasses shown as **Not Connected** |
| Trusted Circle | Add, view, edit, remove contacts; Call / Email open the phone or email app only after a confirmation dialog |
| Settings | Themes, high contrast, text sizes, reduce motion, spoken replies, speech rate, response length, privacy, permissions info, Meta model list, **Check Meta AI connection** |

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
- Database: table `ai_request_log` and function `consume_ai_quota` (30 requests per 10 minutes per hashed client IP).
  Row level security is on with no client policies; only the server role can use them.

### Environment variables

| Name | Where | Secret | Purpose |
| --- | --- | --- | --- |
| `MODEL_API_KEY` | Supabase Edge Function secrets | **Yes** | Meta Model API key. **Not set yet.** |
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

- Photos are processed **only** when the user presses Describe, Find, Read, or Send with a photo attached. The camera is
  never streamed. Photos are not stored by OpenEyes.
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

- **Real Meta responses** until `MODEL_API_KEY` is configured (the app shows "not set up yet" instead of answers).
- **SAM 3.1 segmentation** (exact object outlines). Find uses Muse Spark's description of position instead.
- **Muse Voice Transcribe.** Voice input uses the browser speech service.
- **Meta glasses connection.** The Connect button never shows a fake success.
- **Proactive assistance.** Configuration only; there is no environmental monitoring.

## Planned features (Phase 3+)

- SAM 3.1 integration for Find
- Muse Voice Transcribe for voice input
- Native Android app (Kotlin) using the official Meta Wearables Device Access Toolkit, hosting this UI
- Proactive, opt-in contextual announcements

See [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md) for the Android requirements.

## Project structure

```
src/
  App.tsx                 routes (all except Home are lazy-loaded)
  main.tsx                entry; builds the default service set
  components/             accessible building blocks (Dialog, Notice, CameraCapture, PhotoAttachment, AIResult, FindResultCard, MetaConnectionCheck, ...)
  pages/                  one file per section
  hooks/                  useSettings, useAnnouncer, useCamera, useAIRequest, useSpeechRecognition, useSpeechSynthesis, ...
  services/
    ServicesContext.tsx   dependency injection of every provider (swapped in tests)
    ai/                   Meta providers, backend client, image preparation, conversation context, model catalog, unavailable providers
    voice/ camera/ devices/ memory/ settings/ storage/
  types/                  provider interfaces
supabase/
  functions/openeyes-ai/  server function: index.ts (Deno entry), core.ts (logic, tested)
```

## Data storage

Settings, memories, contacts and (optionally) the conversation are stored **only in this browser's `localStorage`**
under keys prefixed with `openeyes.`. The server stores only a one-way hash of the client IP address and a time stamp
for rate limiting; these rows are deleted after one day. Photos and messages are not stored on the server.

## Accessibility considerations

- Semantic landmarks, one `h1` per screen, skip link; focus moves to the page heading on navigation
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

`npm test`: **106 tests passing** in 9 files (58 from Phase 1, 48 new). New tests use mocked servers and mocked Meta
responses only and **do not prove real Meta connectivity**. They cover: request format and bearer auth, invalid
credentials, network failure, timeout, cancellation, unsupported image type, size limits, server rate limits, missing
key, object not found, unreadable text, line breaks in read text, conversation bounding, memory confirmation (save and
cancel), memories passed as background, no automatic speech, and UI flows on Explore, Find, Read and Assistant.

## Known limitations

- **No real Meta API request has succeeded yet** because `MODEL_API_KEY` is not configured.
- Answer quality, latency and Meta's own rate limits are unverified until the key is added.
- Find reports approximate positions in words only; it cannot measure distance and does not use SAM 3.1 yet.
- Memory relevance uses simple keyword matching.
- Speech recognition depends on browser support (Chrome/Edge yes, Firefox no) and follows the browser language.
- Data is per-browser and per-device; private browsing may discard it.
- Not yet tested manually with TalkBack or VoiceOver on physical devices.
