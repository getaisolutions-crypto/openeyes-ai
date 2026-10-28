# OpenEyes AI - Integration Plan (Phase 2+)

This document records requirements for work that is **not implemented** in Phase 1.
Specific API shapes, endpoints and SDK calls must be taken from official Meta documentation when the work begins;
nothing here should be read as a description of an existing integration.

## 1. Secure backend for Meta AI models

Why: API credentials must never ship in the web or Android client. Anything in a `VITE_*` variable is public.

Requirements:

- A server-side service (for example a serverless function) that holds Meta API credentials as server secrets.
- The client calls only the OpenEyes backend, authenticated per user/device.
- Validates and size-limits all inputs (text length, image size and type, audio duration).
- Rate limiting and abuse protection.
- No logging of images, audio, or personal text beyond what is required for operation; document retention.
- Explicit user consent before the first image or audio upload, and a visible indicator whenever data is sent.

Client work:

- Implement `AIProvider`, `VisionProvider` and `ObjectDetectionProvider` (`src/types/ai.ts`) against the backend.
- Register them in `createDefaultServices()` (`src/services/ServicesContext.tsx`).
- Optionally implement a `VoiceProvider` backed by Muse Voice Transcribe.

Model mapping (to be confirmed against official docs, including which inputs each model accepts):

| Model | Planned use | Interface |
| --- | --- | --- |
| Muse Spark | Conversation, scene description, text reading | `AIProvider`, `VisionProvider` |
| Muse Spark Open | Open-weight conversation option | `AIProvider` |
| SAM 3.1 | Locate/segment a named object | `ObjectDetectionProvider` |
| Muse Voice Transcribe | Speech-to-text | `VoiceProvider` (recognition side) |

Models are not assumed to accept identical inputs; each provider adapts its own request format.

## 2. Native Android app and Meta glasses

The browser cannot access the Meta glasses camera. Glasses support requires a native Android app.

Requirements:

- Kotlin Android app that hosts this web UI (for example in a WebView) or reimplements it natively.
- Integrate the **official Meta Wearables Device Access Toolkit**, following Meta's documentation, terms and
  required app registration. No custom Bluetooth camera access.
- Request Android runtime permissions (camera, microphone, Bluetooth/nearby devices as required by the toolkit) only when needed.
- Expose a bridge to the web layer matching `NativeGlassesBridge` (`src/services/devices/nativeBridge.ts`):
  availability, connect, disconnect, device info and single-frame capture.
- Implement a `DeviceProvider` and a `CameraProvider` for `meta-glasses` that use the bridge, and enable the
  "Meta glasses camera" source option only when the bridge reports a real connection.
- The app must remain fully usable with only the phone.

## 3. Proactive assistance

Phase 1 stores preferences only. A future implementation must be opt-in, respect quiet mode and frequency,
always offer an immediate stop, and clearly indicate when the camera is active.
