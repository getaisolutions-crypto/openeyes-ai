# OpenEyes Glasses (Android companion, Phase 8)

A separate native Android app (Kotlin) that connects OpenEyes to **Ray-Ban Meta Wayfarer Gen 2** glasses through
the official **Meta Wearables Device Access Toolkit (DAT)**. It takes one photo with the glasses camera, sends it to
the existing OpenEyes server function (`openeyes-ai`, Muse Spark), and speaks the answer.

The website is unchanged. This folder is not part of the web build (`package.json` and `vite.config.ts` are untouched).

> Status: **written but not compiled and not tested on hardware.** No Android SDK, JDK or Gradle was available in
> the environment where this was written. Treat every glasses behaviour below as unverified until it has passed the
> Galaxy S24 test steps at the end of this file.

## 1. SDK verification (what was checked, and where)

Sources: `github.com/facebook/meta-wearables-dat-android` (README and `AGENTS.md`) and
`wearables.developer.meta.com` (setup and known-issues pages).

| Item | Finding | Used here |
| --- | --- | --- |
| Status | Developer preview | - |
| Distribution | Maven Central, group `com.meta.wearable`, no token | `mavenCentral()` |
| Version | README shows 1.0.0, `AGENTS.md` setup shows 1.0.1 | `mwdat = 1.0.1` (fall back to 1.0.0 if not resolvable) |
| Requirements | Android 10+ (API 29), Kotlin 2.2+, Android Studio Flamingo+ | minSdk 29, Kotlin 2.2.0 |
| Supported glasses | Ray-Ban Meta glasses; confirm Wayfarer Gen 2 in the current supported-devices list on wearables.developer.meta.com | Camera only |
| Manifest | `com.meta.wearable.mwdat.APPLICATION_ID` and `...CLIENT_TOKEN` meta-data; "0" works in Developer Mode | From `local.properties` |
| Privacy opt-outs | `ANALYTICS_OPT_OUT`, `CRASH_REPORTING_OPT_OUT` meta-data | Both `true` |
| Callback | VIEW / BROWSABLE intent filter with a custom scheme | `openeyesglasses://` |
| Init | `Wearables.initialize(context)` before any other call, returns `DatResult` | `WearablesController.initialize()` |
| Registration | `Wearables.startRegistration(activity)`, observe `Wearables.registrationState` until `REGISTERED` | Register button |
| Devices | `Wearables.devices` flow | "device nearby" flag only, never "connected" |
| Camera permission | `Wearables.checkPermissionStatus(Permission.CAMERA)`, `Wearables.RequestPermissionContract()`; granted in the Meta AI app | Allow glasses camera button |
| Session | `Wearables.createSession(AutoDeviceSelector())`, `session.state` (IDLE, STARTING, STARTED, PAUSED, STOPPING, STOPPED), `session.errors`, fire-and-forget `start()` / `stop()`; STOPPED is terminal | Connect button; "Connected" only on STARTED |
| Camera | `session.addCamera(StreamConfiguration(videoQuality, frameRate))` only after STARTED; `camera.stream.start()`, `stream.state`, `stream.capturePhoto()` (only while streaming) returning `PhotoData.Bitmap` or `PhotoData.HEIC`; one capture at a time | One photo per request |
| Cleanup | `camera.stop()` invalidates the camera; `session.removeCamera()` allows a later `addCamera` | After every photo |
| Pauses | Glasses off, folded, another experience or Bluetooth drop pause the session; wait for the next state | Announced, not forced |
| Microphone / speech | `Permission.MICROPHONE`, `mwdat-speech` and Audio Streaming are **experimental** and need Developer Center approval | **Not used** |
| Voice Invocations ("open app" by voice) | **Experimental**, configured in the Developer Center | **Not used** |
| Speech output to glasses | No toolkit text-to-speech or audio output API found | Android TextToSpeech over the phone's audio route |
| Background | No guarantee of background camera access; sessions pause when another experience takes over | Foreground only |
| Mock device | `mwdat-mockdevice` (`MockDeviceKit`) can simulate glasses, permissions and a captured image | Not wired in yet |

Not shown verbatim in the guide (check in Android Studio with auto-import; marked `VERIFY` in code): the packages of
`Permission`, `PermissionStatus` and `StreamState`. If they differ, only the import lines change.

## 2. How a request works

1. The user presses **What am I looking at?** (or **Ask a question** and speaks).
2. If the toolkit has not reported the session as STARTED, OpenEyes says the glasses are not connected. Nothing else happens.
3. The camera permission is re-checked with the toolkit.
4. A camera is attached, the stream started, and OpenEyes waits up to 12 s for STREAMING.
5. One photo is captured, downsized to at most 1280 px on the long side, and JPEG-encoded **in memory**.
6. The camera is stopped and removed, so the glasses camera light goes off.
7. The photo is sent over HTTPS to the same `openeyes-ai` function and request format the website uses
   (`task: describe` for "what am I looking at", otherwise `task: chat` with the question).
8. The answer is spoken. Questions about crossing, traffic, stairs or safety get a notice first: OpenEyes cannot
   say whether it is safe to move.

**Stop** cancels listening, the photo, the server request and speech. A reply that arrives after Stop is discarded.

## 3. Voice

- **Activation:** there is no wake word. "Hey OpenEyes" is **not supported** (the toolkit's Voice Invocations are
  experimental and unapproved). Use the large **Ask a question** button. With TalkBack on, double-tap it.
- **Listening:** Android `SpeechRecognizer`, one question per press. Android chooses the microphone; it may be the
  phone, not the glasses.
- **Speaking:** Android TextToSpeech with assistant audio. If the glasses are the phone's active Bluetooth audio
  device, Android should play it through the glasses speakers. **Not verified.**
- **Status announcements:** with TalkBack on, the three live status lines are read by TalkBack. Without TalkBack,
  OpenEyes speaks connection changes itself.

## 4. Project structure

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties
  gradle/libs.versions.toml            versions (DAT 1.0.1, Kotlin 2.2.0, AGP 8.9.1)
  gradle/wrapper/gradle-wrapper.properties  Gradle 8.11.1 (Android Studio adds the wrapper scripts)
  local.properties.example             server URL, public key, DAT IDs
  app/build.gradle.kts
  app/src/main/AndroidManifest.xml
  app/src/main/java/ai/openeyes/glasses/
    MainActivity.kt                     screen, Android permissions, Meta AI callbacks
    MainViewModel.kt                    wires glasses, server, voice
    core/GlassesStatus.kt               status model, spoken and on-screen status text
    core/Ports.kt                       interfaces for glasses, server and speech (fakes in tests)
    core/SceneAssistant.kt              one photo -> Muse Spark -> speech; cancel and error messages
    core/ImageSizing.kt                 downsizing rule
    backend/OpenEyesClient.kt           request format and error mapping for openeyes-ai
    backend/UrlConnectionTransport.kt   HTTPS transport
    glasses/WearablesController.kt      the only file that calls the toolkit
    glasses/PhotoEncoder.kt             Bitmap / HEIC -> JPEG in memory
    voice/AndroidSpeaker.kt             TextToSpeech
    voice/QuestionListener.kt           SpeechRecognizer, single question
  app/src/main/res/                     layout, strings, high-contrast theme
  app/src/test/java/ai/openeyes/glasses/ JVM unit tests with fakes (no SDK, no device)
```

## 5. Security and privacy

- Photos stay in memory and are never written to storage or the gallery. Only one photo per request.
- The app holds only the server URL and the **public** key the website already ships. The Meta API key stays on the
  server. `local.properties` is git-ignored.
- HTTPS only: a non-`https://` server URL is refused before any request.
- Toolkit analytics and crash reporting are opted out.
- The camera runs only during a request and is stopped and removed afterwards, including after Stop or errors.
- Server usage limits (per client IP) still apply.

## 6. Install Android Studio (one time)

1. Download Android Studio (Narwhal or newer recommended; Flamingo is the documented minimum) from
   developer.android.com/studio and install it.
2. On first start, choose **Standard** setup. This installs the Android SDK, platform tools and a bundled JDK 17+.
3. In **Settings > Languages & Frameworks > Android SDK**, install **Android 15 (API 35)** SDK Platform.
4. **File > Open** and select this `android` folder (not the repository root).
5. If Android Studio offers to create or update the Gradle wrapper, accept. Let the first Gradle sync finish.
6. If sync reports Kotlin or AGP version issues, accept Android Studio's suggested AGP update; keep Kotlin at 2.2 or newer.

## 7. Developer setup

### Server address and public key (required)

The app calls the **same** `openeyes-ai` server function the website uses:
`POST https://<project-ref>.supabase.co/functions/v1/openeyes-ai`. The build fills in that address and the public
(anon) key automatically, checking in this order:

1. `local.properties`: `openeyes.supabaseUrl` and `openeyes.publicKey` (optional `openeyes.functionUrl` overrides the full address).
2. Environment variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. The website's `.env` file in the repository root (present in the Bolt project download, **not** in a GitHub
   clone, because `.env` is git-ignored).

If none provides them, building or installing the APK stops with a clear message instead of producing an app that
cannot answer. Unit tests still run. The Meta API key is never needed on the phone.

### Steps

1. Copy `local.properties.example` to `local.properties` (Android Studio also writes `sdk.dir` into it).
2. If the repository root has no `.env`, set `openeyes.supabaseUrl=https://<project-ref>.supabase.co` and
   `openeyes.publicKey=<the website's VITE_SUPABASE_ANON_KEY>`.
3. Keep `mwdat.applicationId=0` and `mwdat.clientToken=0` while using Developer Mode.
4. Sync, then fix any `VERIFY` imports with Alt+Enter if they are red.
5. Run unit tests: right-click `app/src/test` > **Run Tests**, or `./gradlew :app:testDebugUnitTest`.
6. Build: **Build > Make Project**, or `./gradlew :app:assembleDebug`.

### Rebuilding and reinstalling after a change

1. **File > Sync Project with Gradle Files**.
2. **Build > Clean Project**, then **Build > Make Project** (a stale build can keep old server settings).
3. With the S24 on USB, press **Run**. Or **Build > Build App Bundle(s) / APK(s) > Build APK(s)** and install
   `app/build/outputs/apk/debug/app-debug.apk`.

### Diagnostics (debug builds only)

In **Logcat**, filter by tag `OpenEyes`. Each request logs: the configured server address and whether a public key
is present, capture success or failure with the JPEG size in bytes, the request address and task, HTTP status and
time, the server's error code, and whether the answer was parsed. Keys and image data are never logged. Release
builds log nothing.

### Which "not set up" message?

- "This copy of OpenEyes Glasses was built without the OpenEyes server address" - the APK had no server address or
  public key. Fix the configuration above and rebuild. Nothing was sent.
- "Meta AI is not set up on the OpenEyes server yet" - only when the server itself answers `not_configured`
  (its Meta API key secret is missing). The website shows the same problem.

## 8. Exact Galaxy S24 test instructions

Preparation (phone):

1. Galaxy S24 on Android 14 or newer. **Settings > About phone > Software information**, tap **Build number** seven
   times. In **Developer options**, turn on **USB debugging**.
2. Update the **Meta AI** app from Google Play. Pair the Ray-Ban Meta Gen 2 glasses in it if not already paired.
   Update the glasses firmware if the app offers it.
3. In the Meta AI app, turn on **Developer Mode** for these glasses as described in Meta's setup guide (at the time
   of writing: **Settings > App info**, tap the version number five times, then switch Developer Mode on; menu names
   may change). Check again after app or glasses updates; it can reset.
4. **Settings > Connections > Bluetooth**: the glasses should be connected, with **Calls** and **Audio** enabled
   so phone audio can play on the glasses.
5. Connect the S24 to the computer with USB, accept the debugging prompt. In Android Studio choose the S24 and press **Run**.

Test steps (record pass/fail for each):

1. **Launch:** allow **Nearby devices**. Expected: "Not registered with Meta AI".
2. **Register:** press **Register with Meta AI**. The Meta AI app opens; approve. Expected on return: "OpenEyes is
   registered with Meta AI" is spoken and the button changes to Unregister.
3. **Camera permission:** press **Allow glasses camera**, choose **Allow always** in Meta AI. Expected: camera line no
   longer says "permission not given".
4. **Connect:** glasses on, unfolded and worn. Press **Connect glasses**. Expected: "Connecting to glasses" then
   "Glasses connected", "Session active". If it never reaches connected, note the glasses message shown.
5. **Demo:** point your head at a known object. Press **What am I looking at?**. Expected: "Looking." then the
   camera light on the glasses turns on briefly, then off, then a short description is spoken. Note **where you
   hear it** (glasses speakers or phone speaker) and the total time.
6. **Voice question:** press **Ask a question**, say "What colour is this?". Expected: a spoken answer about the
   colour. Note which microphone picked it up (try speaking quietly with the phone in a pocket).
7. **Spoken "What am I looking at?"** via Ask a question: expected to behave like step 5.
8. **Stop:** start step 5 and press **Stop** immediately. Expected: silence, no late answer, camera light off.
9. **Busy:** press What am I looking at? twice quickly. Expected: only one answer.
10. **Pause:** take the glasses off or fold them while connected. Expected: "Glasses paused" announced; then put
    them back on and check whether the session returns to active by itself.
11. **Disconnect:** turn the glasses' Bluetooth off (or walk away). Expected: "Glasses disconnected" or "paused";
    pressing What am I looking at? says the glasses are not connected. Reconnect with **Connect glasses**.
12. **Permission denial:** in Meta AI, revoke OpenEyes camera access, press What am I looking at?. Expected: the
    "not allowed to use the glasses camera" message, no request sent.
13. **No internet:** turn on airplane mode with Bluetooth back on. Expected: "could not reach its server".
14. **Safety:** ask "Is it safe to cross?". Expected: the safety notice before any description, never "safe".
15. **TalkBack:** turn TalkBack on (volume up + down for 3 s, or Accessibility settings), repeat steps 4 and 5 using
    swipe and double-tap. Expected: every button and status line is read, status changes are announced once.
16. **Screen off / app in background:** lock the phone during a request. Record what happens (expected: not
    guaranteed to finish).

Only steps that pass on the S24 with real glasses should be described as working.

## 9. Known limitations

- Developer preview SDK; registration and camera access require Developer Mode until the app is approved in the
  Wearables Developer Center (production `APPLICATION_ID` / `CLIENT_TOKEN`).
- No wake word, no glasses-microphone guarantee, no guaranteed glasses speaker output.
- Foreground use only. Answers describe a single photo, not live video.
- No navigation or safety judgements.
