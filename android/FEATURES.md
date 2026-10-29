# OpenEyes Glasses 0.7.0: Full Android AI Experience

This guide covers the four features added in 0.7.0. Setup, the server address and the original features are described in `README.md`.

## Home screen

- **OpenEyes AI** title, then three spoken-friendly status lines:
  - **Glasses**: connected, disconnected, connecting or paused.
  - **Camera**: available, unavailable (with the reason), starting or on.
  - **AI**: Checking, Ready, or Unavailable with the reason (app built without the server address, Meta AI not set up on the server, or server unreachable). "Check AI again" appears when the server could not be reached.
- Four large buttons: **Explore**, **Find Objects**, **Read Text** and **Ask OpenEyes**. Each one has a TalkBack description.
- **Quick look** keeps "What am I looking at?", "Ask a question" and "Stop" exactly as before.
- **Glasses setup** keeps the Connect, Allow glasses camera and Register buttons, plus the detailed status lines.

Every feature screen has Back (which also stops the feature), a title, a live status line, an error line, Stop or Stop speaking, and spoken feedback. Status is always written in words, never shown by colour alone.

## How the camera is shared

`CameraModeCoordinator` lets one camera feature run at a time: quick look, Explore, Find or Read.

- **Starting a feature** cancels the previous feature and its outstanding AI request before the new one starts. The camera stream is handed over to the new feature rather than restarted.
- **Stop, Back and leaving the app** end the feature and turn the glasses camera off.
- **A real disconnect** ends the feature. A pause (glasses taken off, cap-touch tap) does not.

Ask OpenEyes never uses the camera.

`WearablesController` keeps one camera stream running for repeated photos. `capturePhoto()` works repeatedly while the stream runs, and only one photo can be in progress at a time.

- **When the stream stops:** after 20 seconds without a photo, or straight away when a feature stops.
- **Getting the camera back:** if the toolkit refuses to add a second camera to the same session, the app restarts the glasses session once and tries again. The status line shows "Restarting the glasses camera" meanwhile.
- `session.removeCamera()` is **not** used; it failed to compile with toolkit 1.0.1.

## Live Explore

- Takes one photo at a time with the `scene_check` task, sending the previous summary so the server can report what changed.
- **First description:** spoken in full.
- **After that:** it speaks only reported changes, or a clearly different view. Near-repeats are suppressed.
- **Pacing:** 8 seconds between photos, growing by 4 seconds while nothing changes, up to 16 seconds. The pace resets after a change. It always waits for speech to finish before the next photo.
- **Questions:** asked by voice or typing while exploring. A question interrupts speech and is answered from a fresh photo. A description that was still on its way when you asked is discarded.
- **Errors:** three camera or AI failures in a row stop Explore with an explanation. Setup errors stop it immediately. When the server says "too many requests", it waits as long as the server asks.
- **Safety:**
  - Low-confidence descriptions start with "I'm not certain, but".
  - Any sentence claiming a path is clear or safe is removed and replaced by the cane and guide dog caution.
  - Safety questions get the existing safety notice.

## Find Objects

- **Input:** the target is typed or spoken, up to 80 characters, and shown as "Looking for: …".
- **Search:** each photo is sent with the `find` task, one at a time, 5 seconds apart, at most 24 photos.
- **Results:**
  - **Found:** the server's approximate position, with "approximate location, not a measured distance". The search ends here.
  - **Possibly found:** the position, plus "I am not sure, hold still". The search continues.
  - **Not detected:** the server's suggestion, or "Turn your head slowly". This is spoken on the first miss and then every third miss.
- If the server gives no position, the app says it cannot tell where the item is. It never invents one.

## Read Text

- **Reading:** one photo is sent with the `read` task.
  - If nothing could be read, it says so and asks you to adjust light, distance and steadiness. It never guesses at the words.
  - Parts marked `[unreadable]` are flagged on screen and in speech.
- **Original text:** always shown under its own heading.
  - **Repeat** and **Read slower** use the stored text, with no new AI request.
- **Summarize, Translate (Spanish by default, any language can be typed), What does this mean, Important information only:**
  - sent as a text-only `chat` request containing the quoted transcription;
  - shown under "From Meta AI (not the original text)";
  - long text is cut to its first 1,600 characters, and the answer says so.
- **Questions:** use `ask_text` with the same photo. Answers say whether they come straight from the text, a summary, an inference, or "I couldn't find that in the text."
- **Storage:** the text and photo stay in memory only, until Clear, Read new text or leaving the screen.

## Ask OpenEyes

- **Conversation:** text-only `chat`, typed or spoken. It never uses the camera and works without glasses.
- **Context:** earlier turns are sent, so follow-ups work, for example "Tell me about Michigan", then "What is its capital?". Only the last 12 messages and 11,000 characters are sent, to stay inside the server's limits.
- **Duplicates:** a second question while one is being answered is refused with "Still thinking about your last question".
- **Failures:** a failed question stays visible, marked "Not answered", and is not sent again as context.
- **Controls:** Stop speaking, Repeat and New conversation (which clears the history). The status line shows Listening, Asking Meta AI or Speaking.

## Voice

- All screens share one `QuestionListener` and one `AndroidSpeaker`.
- Listening always stops speech first, so OpenEyes does not hear itself.
- Answers and errors replace whatever is being spoken; status cues queue behind each other.
- `awaitSilence()` stops a feature from talking over itself.
- There is no wake word. Press Speak to talk.
- **Audio routes (check each one separately on the device):**
  - **Speech output** goes to the glasses speakers when the glasses are the active Bluetooth audio device, otherwise to the phone.
  - **The microphone** is whichever one Android chooses for speech recognition, often the phone's own.

## Known limitations

1. **No live video analysis.** Explore and Find use a photo every few seconds, so fast changes can be missed.
2. **Server request quota.** The server allows 90 requests per 10 minutes for each network address. Continuous Explore stays below it, but long Find sessions plus questions can reach it. When that happens the app waits and says so.
3. **Camera restart.** Restarting the camera after it has been off can take a few seconds, because of the session restart described above.
4. **No wake word.** The toolkit does not provide one.
5. **Microphone choice.** Which microphone is used is decided by Android.

## Automated tests

Unit tests run on the JVM with fakes:

```
./gradlew :app:testDebugUnitTest
```

- `FeatureControllersTest`: the camera coordinator, Explore, Find, Read and the conversation, plus disconnect handling.
- `SceneAssistantTest`, `OpenEyesClientTest`, `GlassesStatusTest`: the existing tests.

These tests had not been run when this guide was written (no Android SDK in Bolt).

## Rebuild in Android Studio

1. Copy `android/` over your local copy. Keep any local import fixes on lines marked `// VERIFY`.
2. **File > Sync Project with Gradle Files.**
3. Run `./gradlew :app:testDebugUnitTest`.
4. Run `./gradlew :app:installDebug` with the Galaxy S24 connected. This installs version 0.7.0.
5. Filter Logcat by the tag `OpenEyes` to see the diagnostics.

## Real-device checklist

1. **Explore:** start it and turn slowly.
   - You hear one full description, then only changes.
   - Ask "What colour is that?" by voice. Speech stops and you hear the answer.
   - Press Stop. The camera status changes to off at once.
2. **Find:** say "keys".
   - The target is shown on screen.
   - Misses are not repeated every time.
   - Once the keys are visible, you hear "Found keys: …" and the search ends.
   - Press Stop during a search. It ends straight away.
3. **Read:** read a printed sign.
   - The original text is shown and spoken.
   - Try Repeat, Read slower, Summarize, Translate (Spanish), "What does this mean?", Important information only, and a typed question.
   - Cover the camera and read again. You hear the "won't guess" message.
   - Clear removes the text.
4. **Conversation:** with the glasses disconnected, ask "Tell me about Michigan", then "What is its capital?".
   - The second answer uses the first.
   - Check Stop speaking, Repeat and New conversation.
   - Turn on aeroplane mode and send a message. You get a clear network error.
5. **Mode switching:** start Explore, press Back, open Find and start a search.
   - Only one feature talks.
   - No "Still working" errors.
   - The camera keeps working, or recovers with "Restarting the glasses camera".
6. **Disconnection:** during Explore, fold or turn off the glasses.
   - Explore stops and you hear "Glasses disconnected".
   - A pause (cap-touch tap) does not stop Explore; the photos resume when the glasses do.
