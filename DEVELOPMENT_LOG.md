# OpenEyes AI - Development Log

## 2026-10-31 - Android app: AI backend configuration fix

**Reported:** on a Galaxy S24 the glasses registered, connected, the session was active and the capture sound
played, then the app said "Meta AI is not set up on the OpenEyes server yet".

**Investigation:** the website and the app call the same function (`POST /functions/v1/openeyes-ai`, anon key in
`Authorization` and `apikey`, body `{task, image:{dataUrl, capturedAt}, messages|responseLength}`, reply
`{task, model, text}`). The server was checked live: GET reported `configured: true` (model `muse-spark-1.3`) and a
POST in the exact Android format with a real JPEG returned 200 with a description.

**Root cause:** the Android client raised its own "not configured" error, worded as a server problem, when the APK
was built with an empty server address or public key. Those came only from `local.properties`, which a GitHub
clone does not have (and the root `.env` is git-ignored), so no request ever left the phone. A bare HTTP 503 was
also mislabelled the same way.

**Fix:**
- New app-side error and message ("built without the OpenEyes server address"); the server message is used only
  when the server returns `not_configured`. Bare 503 is now a generic server error.
- Gradle reads the server address and public key from `local.properties`, environment variables, or the website's
  root `.env`, and refuses to assemble or install an APK without them.
- Debug-only diagnostics (Logcat tag `OpenEyes`): configuration presence, capture result and JPEG size, request
  URL and task, HTTP status and time, server error code, parse result. No keys or image data.
- Restored `android/.gitignore`. Unit tests added for all of the above.

**Not changed:** server function, website, registration, connection, camera, session and audio code.

**Tests:** web typecheck, tests and build in Bolt; live server GET/POST. Android unit tests and Gradle build cannot
run in Bolt (no JDK, Android SDK or Gradle). No physical glasses testing was done in Bolt.

## 2026-10-30 - Phase 8: Ray-Ban Meta Gen 2 Android companion (v0.6.0 of the Android app)

### Added

- `android/`: separate Kotlin Android project (AGP 8.9.1, Kotlin 2.2.0, minSdk 29, DAT `mwdat-core` and
  `mwdat-camera` 1.0.1 from Maven Central). Website, root `package.json` and `vite.config.ts` unchanged.
- `WearablesController`: initialize, registration, device list, camera permission, session state and errors,
  one-photo capture (add camera after STARTED, start stream, wait for STREAMING, `capturePhoto`, stop and remove).
- `SceneAssistant`: one photo, then `describe` or `chat` against `openeyes-ai`, then speech; Stop discards late
  replies; error and safety messages.
- `OpenEyesClient`: same headers and request format as the web client; error codes mapped.
- Android TextToSpeech output and one-shot SpeechRecognizer questions. High-contrast screen with 72-96 dp buttons
  and live status lines.
- JVM unit tests (assistant, status, client) with fakes.

### Checks

- Web: typecheck passes, 376 tests passing in 26 files, build succeeds.
- Android: not compiled, unit tests not run (no JDK, Android SDK or Gradle available). No hardware testing.

### Not verified

- Import packages for `Permission`, `PermissionStatus`, `StreamState` (marked VERIFY).
- Audio routing to the glasses speakers, microphone source, background behaviour, all real-device flows.
- GitHub sync: not a git repository here; push via Bolt's GitHub integration.

## 2026-10-29 - Voice system repair (v0.5.1)

### Changed

- `voiceConversationEngine.ts`: silence keeps listening (removed `maxSilentRounds`); rapid-end detection
  (`maxRapidEnds` 8, `rapidEndMs` 1000); error backoff up to 4 s, park after 4 failures; permission re-check via
  `checkPermission`; speech end deadline (`speechDeadlineMs`); deferred/dropped automatic descriptions; diagnostic
  events (`onDiagnostic`). Talk resets parked/unreliable state.
- `voiceDiagnostics.ts` (new), `VoiceDiagnosticsPanel.tsx` (new), Settings section "Voice diagnostics".
- `useVoiceConversation.ts`: permission query, diagnostics recording, clearer paused notice.
- `useLiveExplore.ts`: `runUserTask` restores the conversation flag instead of clearing it; start message for
  conversation mode.
- `metaModels.ts`: Muse Voice Transcribe marked integrated. Settings privacy and voice text corrected.
- Edge functions unchanged.

### Checks

- `npm run typecheck` passes; `npm test` 376 passing in 26 files; `npm run build` succeeds. All mocked; no device testing.

### Not verified

- Real Android Chrome behaviour of automatic restarts, TalkBack, Meta Voice under network loss.
- GitHub sync: the project directory is not a git repository here; push from Bolt's GitHub integration.

## 2026-10-29 - Phases 5, 6 and 7 (v0.5.0)

### Implemented

- Advanced Find: live search session (`useObjectSearch`, `LiveObjectSearch`), one frame at a time, round limit,
  camera-relative and uncertainty wording (`objectSearch.ts`), confirmed location saving (`SaveLocationDialog`).
- Advanced Read: Quick Read, Full Read, Ask About Text with answer basis, Read Again, Clear reading session
  (`readingSession.ts`, `useReadingSession`, `QuickReadCard`, `DocumentQuestions`).
- Memory: categories, subject, due date, done; consent proposals (`memoryIntent.ts`); category filter, export, clear
  all (`MemoryPage`, `MemoryEditor`, `memoryExport.ts`). Old memories default to "note" without being rewritten.
- Daily assistance: pure task session engine (`taskSession.ts`), `useTaskSession` (pause persisted, registered with the
  update system), `TaskPanel`; reminder records with a stated limitation.
- Environmental awareness: `sceneAwareness.ts` (3-minute in-memory scene context, safety filter, rate-limited
  announcement selection), Live Explore integration, Settings section (off by default).
- Unified: rule-based `intentRouter.ts` in the Assistant (find, read, explore, remember, reminder, where-is, task);
  Live Explore "remember that..." with spoken yes/no consent.
- Server (`openeyes-ai`): new tasks `quick_read`, `ask_text`, `task_plan`, `scene_check` with validation, parsers and
  safety rules. The deploy tool reported the function already up to date.
- Version 0.5.0.

### Checks

- `npm run typecheck` passes; `npm test` 360 passing in 25 files; `npm run build` succeeds. All mocked.

### Not verified

- No real Android device testing, no TalkBack testing, no measured Find or Read accuracy.
- Meta segmentation or detection models (SAM) not used: official access not confirmed.
- Not a git repository in this environment, so GitHub sync could not be checked.

## 2026-10-29 - App updates, cache control and version detection (v0.4.2)

### Root cause investigation

- No service worker, PWA manifest or Cache Storage use existed, so no offline cache held old files.
- JS and CSS assets are content-hashed by Vite; a new build always has new file names.
- `index.html` had no explicit caching policy, so Chrome or a CDN could reuse an old copy that points at old assets.
  Most likely cause; live response headers not yet inspected.

### Implemented

- Build plugin in `vite.config.ts`: `{ version, buildId, builtAt }` compiled in as `__APP_BUILD__` and emitted as
  `version.json` (dev server serves it too). `tsconfig.node.json` gains `resolveJsonModule`.
- `src/services/updates/`: `buildInfo`, `updateChecker` (no-store fetch, validation, failure never means up to date),
  `cacheReset` (this origin's Cache Storage and service workers only), `reloadGuard` (same-route cache-busting
  reload, verification, max 2 attempts per 10 minutes), `sessionRegistry`, `updateService`.
- `UpdateProvider` / `useAppUpdate` / `useReloadParticipant`; Live Explore, voice conversation, listening, camera and
  AI requests register a stop action; busy sessions hold back the update notice.
- `UpdateNotice` (banner and confirmation dialogs) in the layout; `AppUpdatesPanel` in Settings > App & updates.
- Side menu footer now shows the embedded version instead of a hard-coded string.
- `public/_headers`: no-cache HTML, no-store `version.json`, immutable assets. Not confirmed to be honoured by Bolt.
- Version 0.4.2.

### Checks

- `npm run typecheck` passes; `npm test` 271 passing in 19 files; `npm run build` succeeds.

### Not verified

- Real Android Chrome, installed PWA, published response headers.
- GitHub: no local repository is connected; the remote main branch was last seen at 0.2.0, nothing was pushed.

## 2026-10-28 - Phase 4.1: Meta Muse Voice Transcribe and hands-free fix (v0.4.1)

### Android listening bug

- **Cause:** hands-free listening resumed only from `SpeechSynthesisUtterance.onend`, which Android Chrome often drops
  (long utterances, unreferenced utterances). The conversation then stayed in "OpenEyes speaking" until a tap.
- **Fix:** `browserSpeechPlayback.ts` speaks replies as referenced chunks and monitors `speaking/pending/paused`. A chunk
  ends on its real event or after it was seen speaking and the engine is quiet for 3 polls; a chunk that never starts
  is retried once then skipped; pause is never treated as finished; the stuck guard is 3x the estimate plus 8 s per
  chunk, so long replies are not cut off. Stop cancels monitoring.

### Meta Voice Transcribe

- Verified the API contract from dev.meta.ai/docs/speech-to-text (endpoint, model, handshake auth, PCM_16KHZ,
  ENDPOINTING events, endStream, close codes).
- New edge function `openeyes-voice`: POST issues a single-use 30 s ticket (hashed in `voice_session_tickets`, rate and
  audio-minute limits per hashed client address); WebSocket `?ticket=` relays audio to Meta with `MODEL_API_KEY` only in
  the server-side handshake; whitelisted events back; 60 s per connection, pacing and frame limits; logs only audio
  duration and outcome.
- Browser: AudioWorklet capture at 16 kHz PCM (ScriptProcessor fallback), `metaVoiceRecognizer.ts` (one connection
  per turn, partials displayed, `speechComplete` submitted, no-speech and max-turn timers, full cleanup),
  `recognizerFallback.ts` (browser recognizer for the same turn, then for the session after 2 failures, with notices).
- Settings > Voice conversation > Speech recognition: Meta Voice (default) or Browser. Consent text updated.
- Diagnostics add recognizer, first words, final words, speech length and time to listening again.

### Verification

- **Real API:** through the deployed relay, a spoken clip returned partials and `speechComplete: "What's on the table in
  front of me?"`, clean close 1000; silence run closed cleanly; ticket reuse refused. Run twice.
- **Automated:** typecheck passes; 238 tests in 18 files pass (56 new, mocked); build passes.
- **Not verified:** hands-free conversation on a real Android phone.

### GitHub

- No local git repository in this workspace. The GitHub `main` branch `package.json` is version 0.2.0, older than this
  project, so nothing was pulled from it. Push this project from Bolt's GitHub integration to bring GitHub up to date.

## 2026-10-28 - Phase 4: Natural voice and real-time conversation (v0.4.0)

### Implemented

- **Start Voice Conversation** on Explore: microphone explanation dialog (first time), permission request, spoken start
  and stop messages, large Talk / Interrupt and Stop conversation buttons, text state indicator, interim words shown.
- **Conversation engine** with a checked state machine (idle, starting, listening, user-speaking, processing,
  assistant-speaking, interrupted, waiting, error, stopped), a hands-free listening loop, turn ids with AbortController
  so stale answers are never spoken, a single speech owner, a session limit (15 minutes) and cleanup on stop, leaving
  the screen, page hide and unmount.
- **Fallbacks:** tap-to-talk after 3 silent rounds or 2 recognition errors; disabled button with an explanation when
  recognition is unsupported; clear spoken message when the microphone is denied or busy.
- **Live Explore integration:** all speech routed through the conversation while it runs; automatic descriptions only
  while idle; voice commands and Live Explore requests share the existing single-request queue; short-term follow-up
  context (last 8 messages, memory only); camera-off answers labelled and Meta AI told it cannot see.
- **Experimental, off by default:** "Hey OpenEyes" wake phrase (foreground only) and interrupt by voice with an echo
  filter.
- **Natural voice interface** (`NeuralTTSProvider`) and player with cancellation and per-sentence fallback to the browser
  voice. No provider connected.
- **Settings > Voice conversation**: hands-free turns, wake phrase, interrupt by voice, timing details; microphone
  privacy note.
- **Diagnostics:** recognition, reply, speech start and end-to-end times per turn; no words or audio.

### Evaluated, not implemented

- **Meta Muse Voice Transcribe:** the realtime API needs the key inside the WebSocket handshake, so it needs a server
  relay. Not built because Edge Function WebSocket relaying is unverified. Plan documented in the README.
- **Neural TTS providers:** Google, Azure, Amazon Polly, OpenAI and ElevenLabs compared in the README. Meta has no TTS
  model.

### Checks

- `npm run typecheck`: pass. `npm test`: 182 passing in 15 files (148 existing unchanged, 34 new). `npm run build`: pass.
- Meta API integration and the edge function were not changed.

### Not verified

- Nothing in Phase 4 has been tested on a real Android phone yet. See "Remaining real-device testing" in the README.

## 2026-10-28 - Phase 3: Live Explore and interactive voice companion (v0.3.0)

### Implemented

- **Live Explore** on the Explore screen: Start, Pause, Resume, Describe now, Stop and Cancel request; text camera badge;
  spoken start and stop confirmations; one-time consent dialog explaining data use; camera permission requested on
  Start; permission denial handled; every camera track stopped on stop, session limit, leaving the screen or closing the
  page. Single photo mode kept unchanged and paused while Live Explore uses the camera.
- **Modes**: Ask only (default), Smart Explore (speaks only on noticeable change or a new person, door, stairs, sign,
  vehicle, etc.), Continuous (skips near-identical repeats). Defaults set in Settings > Live Explore.
- **Periodic frames**: 8 / 12 / 20 / 30 s (minimum 8 s), resized and compressed with the existing image preparation,
  sent through the existing `openeyes-ai` function with brief descriptions; never overlapping; nothing sent while paused;
  rate-limit backoff (server value or 60 s); stop after 3 consecutive network/timeout failures; stop at once on setup or
  sign-in errors; session limit 5 / 10 / 15 minutes and 60 frames.
- **Description manager**: word-overlap similarity (threshold 0.5) to suppress repeats, and detection of new
  attention words.
- **Speech**: automatic spoken answers with browser device voices; pause, resume, stop, rate and **voice selection**
  (new, also in Settings); stale speech callbacks guarded; session transcript with "Based on:" labels.
- **Interruption**: the Talk to OpenEyes button stops speech, then listens; never listens while speaking; user
  questions cancel automatic analysis and take priority. Tap-to-talk only, no true barge-in.
- **Commands**: stop, pause, keep exploring, describe that again, explore what's around me, read that sign, find my
  <item>, remember this (with confirmation), and free questions. Current questions use a fresh frame; past-tense
  questions use the previous frame plus up to 3 earlier observations (labelled possibly out of date) and relevant
  saved memories. Without a running session OpenEyes says so instead of answering.
- **Safety copy**: not a mobility aid, no distances, directions relative to the camera, uncertainty stated.
- **Server**: rate limit raised from 30 to 90 requests per 10 minutes per hashed IP (redeployed). No other change to
  the Meta integration.
- Version bumped to 0.3.0 (`package.json`, `package-lock.json`, sidebar version text).

### Files created

- `src/services/explore/liveExploreController.ts`, `descriptionManager.ts`, `exploreCommands.ts`
- `src/hooks/useLiveExplore.ts`
- `src/components/explore/LiveExplorePanel.tsx`, `LiveTranscript.tsx`, `LiveSpeechControls.tsx`
- `src/components/VoiceSelect.tsx`
- `src/__tests__/liveExplore.test.ts`, `src/__tests__/liveExploreScreen.test.tsx`

### Files modified

- `src/pages/ExplorePage.tsx`, `src/pages/SettingsPage.tsx`, `src/components/AIResult.tsx` (safety note)
- `src/hooks/useSpeechSynthesis.ts`, `src/types/voice.ts`, `src/services/voice/webSpeechVoiceProvider.ts`
- `src/types/settings.ts`, `src/services/settings/settingsStorage.ts`, `src/utils/storage.ts`, `src/test/utils.tsx`
- `src/components/layout/AppLayout.tsx` (version text)
- `supabase/functions/openeyes-ai/index.ts` (quota 90)
- `package.json`, `package-lock.json`, `README.md`, `DEVELOPMENT_LOG.md`

### Tests performed

- `npm run typecheck`: no errors.
- `npm test`: 148 passed in 11 files (106 existing unchanged + 42 new, all with fake timers, fake camera and mocked
  Meta responses).
- `npm run build`: success.

### Known limitations

- Browser SpeechSynthesis voices only (not neural); Chrome speech recognition may use Google's online service.
- No true barge-in; the user taps the mic button to interrupt.
- Live Explore stops when the page is hidden (screen lock, app switch), by design.
- Smart Explore change detection is word-based and can miss small changes.
- Directions are relative to the camera; no distance measurement; not a mobility aid.
- Live Explore not yet verified end to end against Meta from this environment; the project owner reports real answers
  on Android.
- GitHub synchronization not verified: the project folder here is not connected to a Git repository.

### Remaining real-device testing

- TalkBack across the Live Explore flow (no double speech, focus order, badge changes)
- Android Chrome speech recognition, device voice list loading, voice selection and rate
- Frame timing, mobile data use and the 90-per-10-minutes allowance on real networks
- Camera release on app switch, screen lock and page change
- Muse Spark answer quality and latency on real scenes

### Next steps (awaiting instructions)

- Run the real-device checks above and record results here.
- Phase 4 not started.

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
