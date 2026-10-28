# OpenEyes AI - Development Log

## 2026-10-29 - Phase 2: Meta AI visual intelligence (v0.2.0)

### Research (official sources only)

- Read Meta Model API docs (`dev.meta.ai/docs`: overview, models, file handling).
- Confirmed: base URL `https://api.meta.ai/v1`; bearer auth with `MODEL_API_KEY`; OpenAI-compatible
  `POST /v1/chat/completions`; Muse Spark model IDs `muse-spark-1.3` / `1.2` / `1.1` (plus `-contributor` variants that let
  Meta train on data, deliberately not used); images as `image_url` content parts with base64 data URLs.
- SAM 3.1 (`sam-3.1`, Responses API) and Muse Voice Transcribe exist but were not integrated in this phase.

### Implemented

- **Server function `openeyes-ai`** (Supabase Edge Function, deployed, `verify_jwt = true`): validates requests, limits
  sizes and formats, rate limits per hashed IP (new `ai_request_log` table + `consume_ai_quota` function, server role only),
  builds safety-first prompts per task (describe, find, read, chat), calls Muse Spark with a 45 s timeout, maps Meta errors
  (auth, rate limit, rejection, outage, timeout, empty answer) to stable error codes. GET returns a health check.
- **Meta providers** implementing the existing `AIProvider`, `VisionProvider` and `ObjectDetectionProvider` interfaces,
  selected automatically by `ServicesContext`; tests keep the Phase 1 unavailable providers by default.
- **Image preparation**: type and size validation, resize to 1280 px, JPEG re-encode, 4 MB cap, cached per photo.
- **Explore**: Describe my surroundings, with Cancel, error states, Read aloud controls and safety note.
- **Find**: visible / not seen / not sure, position in words, confidence, suggestion; memories labelled as past notes.
- **Read**: text from photo into the read-aloud box with line breaks; "No readable text found" state.
- **Assistant**: optional photo attachment, bounded context (10 messages), relevant memories as labelled background,
  "Remember that..." with confirmation dialog, Cancel, auto-speech only for short replies.
- **Settings**: model list updated (Muse Spark via server, others planned) and Check Meta AI connection.
- Privacy copy updated on camera, Devices and Settings screens to say when a photo is sent.

### Verification

- Deployed function checked directly: health check returns `configured: false`; a POST returns `503 not_configured`.
- **`MODEL_API_KEY` is not configured, so no real Meta API request has been made or verified.** Describe, Find, Read and
  chat are implemented but unverified against the real model.

### Tests performed

- `tsc -b`: no errors.
- `npm test`: 106 passed (58 existing unchanged + 48 new, all mocked): request format, invalid credentials, network
  failure, timeout, cancellation, unsupported format, size limits, rate limits, missing key, object not found, unreadable
  text, conversation context, memory confirmation, UI flows.
- `npm run build`: success.

### Known limitations

- Real Meta connectivity unverified until the key is added; Meta rate limits and pricing not yet reviewed in detail.
- SAM 3.1 not integrated; Find positions are descriptive only, with no distances.
- Memory relevance uses keyword matching.

### Next steps (awaiting instructions)

- Add `MODEL_API_KEY`, then verify each task with real photos and record results here.
- Phase 3 not started.

## 2026-10-28 - Phase 1: Foundation (v0.1.0)

Starting point: the repository contained only a one-line README, an empty `package-lock.json` and `.gitignore`.

### Implemented

- Project setup: Vite 5, React 18, TypeScript (strict), Tailwind CSS 3, React Router 6, Vitest, Testing Library, axe-core.
- Visual identity: eye mark logo, teal and amber palette, Atkinson Hyperlegible typeface; dark (default), light and
  high-contrast themes driven by CSS variables.
- App shell: skip link, mobile bottom navigation (5 primary sections), desktop sidebar (all 9 sections),
  lazy-loaded routes, focus moved to the page heading on navigation, polite and assertive live regions.
- Typed provider interfaces: `AIProvider`, `VisionProvider`, `ObjectDetectionProvider`, `VoiceProvider`,
  `CameraProvider`, `DeviceProvider`, `MemoryProvider`, `ContactsProvider`, injected through a services context.
- Placeholder AI providers that always reject with a user-facing explanation (no fabricated responses).
- Planned Meta model catalog (Muse Spark, Muse Spark Open, SAM 3.1, Muse Voice Transcribe), marked as planned.
- Web Speech API voice provider with feature detection (recognition and synthesis).
- getUserMedia camera provider with mapped error states, capture to local JPEG, local photo upload with type/size checks.
- Phone camera/microphone status detection via `enumerateDevices` and the Permissions API where available.
- Meta glasses device provider that always reports Not Connected and returns `native-integration-unavailable` on connect.
- Native bridge contract (interface only) for the future Android app.
- Screens: Home, Assistant, Explore, Find, Read, Memory, Devices, Trusted Circle, Settings, Not Found.
- Find shows matching saved memories for the requested item (real, local).
- Local, validated `localStorage` collections for memories and contacts; settings sanitised on load.
- Settings: theme, high contrast, text size, reduce motion, spoken replies, speech rate + test voice, response length,
  remember conversation, delete all local data, permissions info, proactive assistance configuration (labelled planned).
- Documentation: README, this log, `docs/INTEGRATION_PLAN.md`.

### Tests performed

Automated, run in jsdom with Vitest on 2026-10-28:

- `npm test`: 6 test files, 58 tests, all passing.
  - Navigation: every route renders its heading, home actions present, nav marks current page, focus moves to heading, 404.
  - Memory: provider create/update/search/remove, validation, malformed storage; UI save requires explicit action, edit, delete with confirmation, cancel, search, Find shows matching memories.
  - Settings: defaults, sanitising invalid values, corrupted JSON, persistence across remounts, proactive controls, stop announcements, delete all data.
  - Camera: error mapping, no camera request until user action, permission denied, unsupported, live preview, capture failure, describe action disabled.
  - Devices: glasses provider never fakes connection, Home shows Not Connected, phone devices unavailable without media APIs, connect dialog, glasses source disabled.
  - Accessibility: axe-core on 8 screens with no violations (color-contrast rule disabled because jsdom cannot compute it), skip link, live regions, dialog focus trap/Escape/focus restore, mic button state, assistant never fabricates replies, real transcript from voice provider is sent.
- `npx tsc -b`: no type errors.
- `npm run build`: succeeded.

Not performed:

- Manual testing on a physical Android phone, with TalkBack, or with VoiceOver.
- Real camera and microphone testing in a browser (the build environment has no browser). Tests use mocked providers for these.

### Known limitations

- No AI model is connected; AI-dependent actions are disabled or return explicit "not available yet" errors.
- Meta glasses cannot be connected; requires the native Android app (not started).
- Proactive assistance is configuration only.
- Browser speech recognition availability varies, and some browsers process speech on their own servers.
- Data is stored only in this browser on this device.

### Next steps (awaiting instructions)

1. Manual accessibility pass on Android Chrome with TalkBack.
2. Design and build the secure backend for Meta model access.
3. Implement real `AIProvider` / `VisionProvider` / `ObjectDetectionProvider`.
4. Begin the Kotlin Android shell with the official Meta Wearables Device Access Toolkit.
