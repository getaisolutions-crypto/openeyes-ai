# OpenEyes AI

**Your World, Understood.**

OpenEyes AI is a voice-first, accessibility-first personal assistant designed to help blind and low-vision people
understand their surroundings, find objects, read text, remember important information and accomplish everyday tasks
more independently. The long-term target is Android smartphones and compatible Meta AI glasses.

> Status: **Phase 1 foundation (v0.1.0)**. The accessible interface, architecture and on-device capabilities are in place.
> **No AI model is connected yet** and **Meta glasses cannot be connected yet**. The app says so explicitly wherever it matters.

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
| Assistant | Real browser speech recognition (where supported, with feature detection), typed input, conversation history, Stop speaking, Clear conversation (with confirmation), loading and explicit error states |
| Explore | Real phone camera: permission request, live preview, capture, retake, remove; unavailable / denied / busy states |
| Find | Type or speak an item name, quick-pick chips, matching items from **your saved memories**, camera capture |
| Read | Camera capture or photo upload (local preview only), paste/type text, read aloud with play / pause / resume / stop using the device voice |
| Memory | Save (explicit action only), view, edit, delete (with confirmation), search; dictate a memory by voice |
| Devices | Real detection of phone camera and microphone availability and permission state; Meta Glasses shown as **Not Connected**; Connect button explains why it cannot connect yet |
| Trusted Circle | Add, view, edit, remove contacts with validation; Call / Email open the phone or email app only after a confirmation dialog |
| Settings | Dark/light theme, high contrast, four text sizes, reduce motion, spoken replies, speech rate with test voice, response length, privacy (remember conversation, delete all local data), permissions info, proactive assistance configuration |

## Placeholders (not functional yet)

These are clearly labelled in the app as "not available yet" or "Planned":

- **AI replies** in the Assistant. The `AIProvider` is a placeholder that always rejects with an explanation. No replies are fabricated.
- **Scene description** (Explore) and **reading text from photos** (Read). Buttons are disabled; photos never leave the device.
- **Object detection / segmentation** (Find). Disabled; no object locations are invented.
- **Meta glasses connection.** The Connect button never shows a fake success.
- **Proactive assistance.** Configuration only; there is no environmental monitoring.
- **Response length** and **spoken replies** settings are stored and will apply once AI replies exist.

## Planned features (Phase 2+)

- Secure OpenEyes backend that holds Meta API credentials and proxies requests
- Meta models (inputs and outputs to be confirmed against official Meta documentation):
  - **Muse Spark**: conversation, scene description, reading text in images
  - **Muse Spark Open**: open-weight option for conversation
  - **SAM 3.1**: locating and outlining a named object for Find
  - **Muse Voice Transcribe**: speech-to-text replacing the browser speech service
- Native Android app (Kotlin) using the official Meta Wearables Device Access Toolkit, hosting this UI
- Proactive, opt-in contextual announcements

See [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md) for the backend and Android requirements.

## Architecture

```
src/
  App.tsx                 routes (all except Home are lazy-loaded)
  main.tsx                entry; builds the default service set
  components/             accessible building blocks (Dialog, Notice, Switch, OptionGroup, CameraCapture, MicButton, layout)
  pages/                  one file per section
  hooks/                  useSettings, useAnnouncer, useCamera, useSpeechRecognition, useSpeechSynthesis, useCollection, useDeviceStatus
  services/
    ServicesContext.tsx   dependency injection of every provider (swapped in tests, and later for real AI)
    ai/                   planned model catalog + placeholder providers that always report "unavailable"
    voice/                Web Speech API provider
    camera/               getUserMedia provider, local photo upload
    devices/              phone camera/microphone detection, Meta glasses provider (always Not Connected), native bridge contract
    memory/               local memory and contacts providers
    settings/             settings validation and persistence
    storage/              generic validated localStorage collection
  types/                  AIProvider, VisionProvider, ObjectDetectionProvider, VoiceProvider, CameraProvider, DeviceProvider, MemoryProvider, ContactsProvider
  utils/                  validation, storage keys, ids, formatting
```

Every feature talks to an interface from `src/types`, obtained through `useServices()`. Phase 2 replaces the placeholder
AI providers and adds a glasses device provider backed by the native bridge without changing the screens.

## Data storage (Phase 1)

All data is stored **only in this browser's `localStorage`** on this device, under keys prefixed with `openeyes.`:

| Key | Contents |
| --- | --- |
| `openeyes.settings.v1` | Settings |
| `openeyes.memories.v1` | Memories |
| `openeyes.contacts.v1` | Trusted Circle contacts |
| `openeyes.conversation.v1` | Conversation, only if "Remember conversation" is on |

Nothing is synchronised across devices or backed up. Clearing browser data removes it. Settings includes
"Delete all OpenEyes data on this device". Stored data is validated on load; malformed entries are discarded.

## Accessibility considerations

- Semantic landmarks (`header`, `nav`, `main`), one `h1` per screen, skip link
- Focus moves to the page heading on navigation and the document title updates
- Polite and assertive live regions for status announcements, plus a visible "Latest status" panel on Home
- Every control has an accessible name; icons are hidden from assistive technology
- Visible, high-contrast focus outlines (thicker in high-contrast mode)
- Touch targets at least 48 x 48 px; primary actions much larger
- Four text sizes that scale the whole interface
- Dark (default), light, and high-contrast themes for both
- Respects `prefers-reduced-motion` and offers an in-app reduce motion switch
- Modal dialogs: focus trap, Escape to close, focus restoration, background marked inert
- Status never relies on color alone: every badge has text and an icon
- Atkinson Hyperlegible typeface, designed for low-vision readers
- Automated axe-core checks run in the test suite (color contrast cannot be computed in jsdom and is checked manually by design tokens)

Designed for Android TalkBack and iOS VoiceOver. Manual testing on real devices with those screen readers is still required.

## Security considerations

- No API keys or secrets exist in the client, and none should ever be added as `VITE_*` variables. Meta API access must go through a secure backend (Phase 2).
- No personal data, audio, or images are sent to OpenEyes or Meta services in Phase 1.
- Camera is requested only when the user presses "Turn on camera", and stops after capture or when leaving the screen. Photos are kept as local object URLs and revoked when discarded.
- Microphone is used only during voice input.
- **Browser speech recognition caveat:** the Web Speech API is provided by the browser. Some browsers (for example Chrome) send audio to their own online speech service. The app discloses this next to the microphone and in Settings.
- User input is validated and length-limited; phone numbers are reduced to digits before building `tel:` links; email addresses are URL-encoded for `mailto:` links.
- Calls and emails never happen automatically; a confirmation dialog opens the phone or email app, where the user must act again.
- `.env` is git-ignored. Do not commit secrets or personal data.

## Known limitations

- No AI functionality yet (see Placeholders).
- Speech recognition depends on browser support (Chrome/Edge on Android and desktop support it; Firefox does not).
- Speech recognition language follows the browser language.
- Device availability detection without permission relies on `enumerateDevices`, which some browsers limit until permission is granted.
- Data is per-browser and per-device; private browsing may discard it.
- Not yet tested manually with TalkBack or VoiceOver on physical devices.
