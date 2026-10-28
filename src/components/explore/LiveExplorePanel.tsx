import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, Loader2, Pause, Play, ScanSearch, Send, Square, X } from 'lucide-react';
import { MicButton } from '../MicButton';
import { Notice } from '../Notice';
import { ConfirmDialog } from '../Dialog';
import { OptionGroup } from '../FormControls';
import { LiveSpeechControls } from './LiveSpeechControls';
import { LiveTranscript } from './LiveTranscript';
import { VoiceConversationControls } from './VoiceConversationControls';
import { VOICE_SESSION_MAX_MINUTES, useVoiceConversation } from '../../hooks/useVoiceConversation';
import { MODE_LABELS, useLiveExplore } from '../../hooks/useLiveExplore';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useSettings } from '../../hooks/useSettings';
import { useServices } from '../../services/ServicesContext';
import { STORAGE_KEYS, readJSON, writeJSON } from '../../utils/storage';
import { formatDateTime } from '../../utils/format';
import type { CameraErrorKind } from '../../types/camera';
import type { ExploreMode } from '../../types/settings';

const CAMERA_PROBLEMS: Record<CameraErrorKind, string> = {
  unsupported: 'This browser cannot use the camera. Try Chrome on Android.',
  'insecure-context': 'The camera only works when OpenEyes is opened over a secure https connection.',
  'permission-denied': 'Camera access is blocked. Allow the camera for this site in your browser or phone settings, then try again.',
  'not-found': 'OpenEyes could not find a camera on this device.',
  'in-use': 'The camera may be in use by another app. Close other camera apps and try again.',
  unknown: 'The camera could not be started. Please try again.',
};

const MODE_DESCRIPTIONS: Record<ExploreMode, string> = {
  ask: 'Camera stays on, but a frame is only sent when you ask something.',
  smart: 'Checks a frame regularly and speaks only when the view changes.',
  continuous: 'Checks a frame regularly and describes each new view.',
};

interface Props {
  /** Lets the page hide the single-photo camera while this one is in use. */
  onActiveChange: (active: boolean) => void;
}

export function LiveExplorePanel({ onActiveChange }: Props) {
  const live = useLiveExplore();
  const { vision } = useServices();
  const { settings, updateSettings } = useSettings();
  const [typed, setTyped] = useState('');
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmVoice, setConfirmVoice] = useState(false);
  const available = vision.getStatus().available;
  const { running, status, startSession, handleInput, setConversationActive, addNotice, addHeard } = live;

  const requestStart = useCallback(() => {
    if (readJSON<boolean>(STORAGE_KEYS.liveExploreConsent, false)) void startSession();
    else setConfirmStart(true);
  }, [startSession]);

  const recognition = useSpeechRecognition({ onFinal: (text) => void handleInput(text, requestStart) });

  const conversation = useVoiceConversation({
    speech: live.speech,
    handleTurn: (text, signal) => handleInput(text, requestStart, signal),
    cancelPending: live.cancelPending,
    setSpeechRouter: live.setSpeechRouter,
    say: live.say,
    addNotice,
    addHeard,
    onEnded: live.clearConversation,
    isExploring: () => running,
  });

  const startConversation = () => {
    setConfirmVoice(false);
    writeJSON(STORAGE_KEYS.voiceConversationConsent, true);
    recognition.stop();
    void conversation.start();
  };

  const requestConversation = () => {
    if (readJSON<boolean>(STORAGE_KEYS.voiceConversationConsent, false)) startConversation();
    else setConfirmVoice(true);
  };

  useEffect(() => {
    if (!recognition.listening) setConversationActive(false);
  }, [recognition.listening, setConversationActive]);

  useEffect(() => onActiveChange(running || status === 'requesting'), [onActiveChange, running, status]);

  const listen = () => {
    setConversationActive(true);
    recognition.start();
  };

  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    if (!typed.trim()) return;
    if (conversation.active) conversation.submit(typed.slice(0, 500));
    else void handleInput(typed.slice(0, 500), requestStart);
    setTyped('');
  };

  const badge =
    status === 'paused'
      ? 'Camera on, paused. Nothing is being sent.'
      : status === 'waiting'
        ? 'Camera on, waiting for Meta AI'
        : status === 'live'
          ? settings.exploreMode === 'ask'
            ? 'Camera on, waiting for your question'
            : 'Camera on, exploring'
          : null;

  return (
    <section aria-labelledby="live-explore-heading" className="card overflow-hidden">
      <div className="p-5 pb-0">
        <h2 id="live-explore-heading" className="text-xl font-bold">
          Live Explore
        </h2>
        <p className="mt-1 text-muted">
          Keep the camera on and talk to OpenEyes about what it sees. Every answer comes from Meta AI looking at a real camera frame.
        </p>
      </div>

      {!running && status !== 'requesting' && (
        <div className="px-5">
          <OptionGroup<ExploreMode>
            legend="Explore mode"
            name="explore-mode"
            value={settings.exploreMode}
            onChange={(v) => updateSettings({ exploreMode: v })}
            options={(['ask', 'smart', 'continuous'] as const).map((value) => ({
              value,
              label: MODE_LABELS[value],
              description: MODE_DESCRIPTIONS[value],
            }))}
          />
        </div>
      )}

      {(running || status === 'requesting') && (
        <div className="relative mx-5 mt-4 aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={live.videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Live Explore camera preview" />
          {status === 'requesting' && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 font-bold text-white">
              <span className="flex items-center gap-2">
                <Loader2 aria-hidden="true" className="h-6 w-6 motion-safe:animate-spin" /> Waiting for camera permission
              </span>
            </div>
          )}
          {badge && (
            <p className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-black/75 px-3 py-1 text-sm font-bold text-white">
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === 'paused' ? 'bg-amber-400' : 'bg-red-500 motion-safe:animate-pulse'}`} />
              {badge}
            </p>
          )}
        </div>
      )}

      <div className="space-y-4 p-5">
        {!available && (
          <Notice variant="warning" title="Live Explore not available yet">
            Live Explore needs the Meta AI connection, which is not set up in this version of the app.
          </Notice>
        )}
        {live.cameraError && (
          <Notice variant="error" title="Live Explore could not use the camera">
            {CAMERA_PROBLEMS[live.cameraError]}
          </Notice>
        )}
        {live.problem && running && (
          <Notice variant="warning" title="Meta AI problem">
            {live.problem}
          </Notice>
        )}

        {!running ? (
          <button
            type="button"
            className="btn-primary w-full text-lg"
            disabled={!available || status === 'requesting'}
            onClick={requestStart}
          >
            <Camera aria-hidden="true" className="h-6 w-6" /> Start exploring
          </button>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {status === 'paused' ? (
              <button type="button" className="btn-primary text-lg" onClick={live.resume}>
                <Play aria-hidden="true" className="h-6 w-6" /> Resume exploring
              </button>
            ) : (
              <button type="button" className="btn-secondary text-lg" onClick={live.pause}>
                <Pause aria-hidden="true" className="h-6 w-6" /> Pause exploring
              </button>
            )}
            <button type="button" className="btn-secondary text-lg" disabled={Boolean(live.busyLabel)} onClick={() => void live.describeNow()}>
              <ScanSearch aria-hidden="true" className="h-6 w-6" /> Describe now
            </button>
            <button type="button" className="btn-danger text-lg" onClick={live.stop}>
              <Square aria-hidden="true" className="h-6 w-6" /> Stop exploring
            </button>
          </div>
        )}

        {live.busyLabel && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-line p-3">
            <p className="flex items-center gap-2 font-bold">
              <Loader2 aria-hidden="true" className="h-6 w-6 text-primary motion-safe:animate-spin" /> {live.busyLabel}
            </p>
            <button type="button" className="btn-secondary" onClick={live.cancelCurrent}>
              <X aria-hidden="true" className="h-5 w-5" /> Cancel request
            </button>
          </div>
        )}

        {running && live.lastCheckedAt && settings.exploreMode === 'smart' && (
          <p className="text-sm text-muted">Last checked {formatDateTime(live.lastCheckedAt)}. OpenEyes stays quiet when nothing has changed.</p>
        )}

        <div className="flex flex-col items-center gap-3 rounded-xl bg-surface-2 p-4 text-center">
          <VoiceConversationControls
            conversation={conversation}
            showDiagnostics={settings.voiceDiagnostics}
            wakePhrase={settings.conversationWakePhrase}
            onRequestStart={requestConversation}
          />
          {!conversation.active && (
            <>
              <MicButton
                listening={recognition.listening}
                onStart={listen}
                onStop={recognition.stop}
                idleLabel="Talk to OpenEyes. Stops speech and listens"
              />
              <p className="font-bold" aria-hidden="true">
                {recognition.listening ? 'Listening' : 'Tap to talk'}
              </p>
              {recognition.interim && <p className="text-muted">{recognition.interim}</p>}
            </>
          )}
          <p className="text-sm text-muted">
            Try: &quot;What&apos;s in front of me?&quot;, &quot;What&apos;s on my left?&quot;, &quot;Read that sign&quot;, &quot;Find my keys&quot;,
            &quot;Describe that again&quot;, &quot;Remember this&quot;, &quot;Pause&quot;, &quot;Keep exploring&quot;, &quot;Stop&quot;.
          </p>
          {recognition.error && (
            <Notice variant="warning" title="Voice input">
              {SPEECH_ERROR_MESSAGES[recognition.error]}
            </Notice>
          )}
        </div>

        <form onSubmit={submitTyped} className="flex gap-2">
          <label htmlFor="live-typed" className="sr-only">
            Type a question or command
          </label>
          <input
            id="live-typed"
            className="field flex-1 text-lg"
            value={typed}
            maxLength={500}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type a question or command"
          />
          <button type="submit" className="btn-primary min-w-[56px] px-4" aria-label="Send question or command">
            <Send aria-hidden="true" className="h-6 w-6" />
          </button>
        </form>

        <details className="rounded-xl border-2 border-line p-4">
          <summary className="cursor-pointer text-lg font-bold">Speech options</summary>
          <div className="mt-4">
            <LiveSpeechControls speech={live.speech} />
          </div>
        </details>

        <LiveTranscript entries={live.transcript} />
      </div>

      <ConfirmDialog
        open={confirmStart}
        title="Before Live Explore starts"
        message={
          <div className="space-y-2">
            <p>OpenEyes will turn on the camera and keep it on until you stop, pause or leave the app.</p>
            <p>
              Only selected frames are sent: when you ask something, or about every {settings.exploreIntervalSeconds} seconds in Smart Explore and
              Continuous mode. Each frame is shrunk and sent securely to Meta AI through the OpenEyes server. Frames are not saved, and sessions stop
              after {settings.exploreSessionMinutes} minutes.
            </p>
            <p>This uses mobile data. OpenEyes is not a mobility aid. Keep using your cane, guide dog or mobility skills.</p>
          </div>
        }
        confirmLabel="I understand, turn on camera"
        onConfirm={() => {
          writeJSON(STORAGE_KEYS.liveExploreConsent, true);
          setConfirmStart(false);
          void startSession();
        }}
        onCancel={() => setConfirmStart(false)}
      />

      <ConfirmDialog
        open={confirmVoice}
        title="Before the voice conversation starts"
        message={
          <div className="space-y-2">
            <p>OpenEyes will ask to use the microphone. It listens only while the conversation is running, and you will hear a short tone each time it starts listening on Android.</p>
            <p>
              Your browser turns your speech into text. Depending on the browser, this may happen on the device or on the browser maker's servers.
              OpenEyes never records or saves audio. The recognized words are sent securely to Meta AI through the OpenEyes server to get a reply.
            </p>
            <p>
              The conversation stops when you say stop conversation, tap Stop conversation, leave the screen or switch apps, and after
              {' '}{VOICE_SESSION_MAX_MINUTES} minutes. OpenEyes never listens in the background.
            </p>
          </div>
        }
        confirmLabel="I understand, turn on microphone"
        onConfirm={startConversation}
        onCancel={() => setConfirmVoice(false)}
      />

      <ConfirmDialog
        open={live.pendingMemory !== null}
        title="Save this memory?"
        message={`"${live.pendingMemory ?? ''}" will be saved in My Memories on this device. You can edit or delete it later.`}
        confirmLabel="Save memory"
        onConfirm={() => void live.confirmMemory()}
        onCancel={live.cancelMemory}
      />
    </section>
  );
}
