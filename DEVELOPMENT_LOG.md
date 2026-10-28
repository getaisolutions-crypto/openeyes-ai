# OpenEyes AI - Development Log

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
