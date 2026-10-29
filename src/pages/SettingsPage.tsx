import { useId, useState, type ReactNode } from 'react';
import { Settings as SettingsIcon, Volume2, VolumeX } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { PlannedBadge } from '../components/StatusBadge';
import { ConfirmDialog } from '../components/Dialog';
import { OptionGroup, Switch } from '../components/FormControls';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { EXPLORE_INTERVALS, EXPLORE_SESSION_MINUTES, SCENE_ALERT_CATEGORIES, SPEECH_RATE } from '../services/settings/settingsStorage';
import { MODE_LABELS } from '../hooks/useLiveExplore';
import { VoiceSelect } from '../components/VoiceSelect';
import { META_MODELS } from '../services/ai/metaModels';
import { MetaConnectionCheck } from '../components/MetaConnectionCheck';
import { AppUpdatesPanel } from '../components/AppUpdatesPanel';
import { VoiceDiagnosticsPanel } from '../components/VoiceDiagnosticsPanel';
import { clearAllAppData } from '../utils/storage';
import type {
  AssistanceMode,
  ExploreMode,
  ProactiveFrequency,
  SceneAlertCategory,
  SceneAlertDetail,
  SceneAlertFrequency,
  SpeechRecognitionChoice,
  TextSize,
  Theme,
} from '../types/settings';

const SCENE_CATEGORY_LABELS: Record<SceneAlertCategory, string> = {
  person: 'People in view',
  door: 'Doors',
  stairs: 'Stairs or steps',
  'new-area': 'Camera pointed at a new area',
  object: 'Objects appearing or moving in the image',
};
import type { ResponseLength } from '../types/ai';

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="card mt-4 p-5">
      <h2 id={id} className="flex flex-wrap items-center gap-2 text-xl font-bold">
        {title}
        {badge}
      </h2>
      <div className="mt-2 divide-y divide-line">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { announce } = useAnnouncer();
  const tts = useSpeechSynthesis();
  const rateId = useId();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const proactive = settings.assistanceMode === 'reactive-proactive';

  const set = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K], message: string) => {
    updateSettings({ [key]: value });
    announce(message);
  };

  return (
    <>
      <PageHeader title="Settings" icon={<SettingsIcon className="h-7 w-7" />} description="Settings are saved on this device." />

      <Section title="Display">
        <OptionGroup<Theme>
          legend="Theme"
          name="theme"
          columns={2}
          value={settings.theme}
          onChange={(v) => set('theme', v, `${v === 'dark' ? 'Dark' : 'Light'} theme on.`)}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
        <Switch
          label="High contrast"
          description="Maximum contrast colors and thicker focus outlines."
          checked={settings.highContrast}
          onChange={(v) => set('highContrast', v, `High contrast ${v ? 'on' : 'off'}.`)}
        />
        <OptionGroup<TextSize>
          legend="Text size"
          name="text-size"
          columns={2}
          value={settings.textSize}
          onChange={(v) => set('textSize', v, 'Text size changed.')}
          options={[
            { value: 'normal', label: 'Standard' },
            { value: 'large', label: 'Large' },
            { value: 'xlarge', label: 'Extra large' },
            { value: 'xxlarge', label: 'Largest' },
          ]}
        />
        <Switch
          label="Reduce motion"
          description="Turns off animations. Your device's reduced motion setting is always respected."
          checked={settings.reduceMotion}
          onChange={(v) => set('reduceMotion', v, `Reduce motion ${v ? 'on' : 'off'}.`)}
        />
      </Section>

      <Section title="Voice">
        <Switch
          label="Speak assistant replies"
          description="Read OpenEyes replies aloud automatically. Takes effect once AI replies are available."
          checked={settings.voiceOutput}
          onChange={(v) => set('voiceOutput', v, `Spoken replies ${v ? 'on' : 'off'}.`)}
        />
        <div className="py-3">
          <label htmlFor={rateId} className="text-lg font-bold">
            Speech rate: {settings.speechRate.toFixed(1)}x
          </label>
          <p className="mt-1 text-muted">Used for read aloud on this device.</p>
          <input
            id={rateId}
            type="range"
            min={SPEECH_RATE.min}
            max={SPEECH_RATE.max}
            step={SPEECH_RATE.step}
            value={settings.speechRate}
            aria-valuetext={`${settings.speechRate.toFixed(1)} times normal speed`}
            onChange={(e) => updateSettings({ speechRate: Number(e.target.value) })}
            className="mt-3 h-12 w-full cursor-pointer accent-[rgb(var(--primary))]"
          />
          <div className="mt-1 flex justify-between text-sm text-muted" aria-hidden="true">
            <span>Slower</span>
            <span>Faster</span>
          </div>
          <button
            type="button"
            className="btn-secondary mt-3 w-full"
            disabled={!tts.supported}
            onClick={() => tts.speak('This is how OpenEyes will sound at this speed.')}
          >
            <Volume2 aria-hidden="true" className="h-5 w-5" />
            {tts.supported ? 'Test voice' : 'Speech output not supported in this browser'}
          </button>
        </div>
        {tts.supported && (
          <div className="py-3">
            <VoiceSelect />
          </div>
        )}
      </Section>

      <Section title="Voice conversation">
        <div className="py-3">
          <Notice variant="info" title="How the microphone is used">
            The microphone is only used after you press Start Voice Conversation on the Explore screen, and it turns off when
            you stop, leave the screen or switch apps. It is off while OpenEyes speaks unless Interrupt by voice is on. With
            hands-free turns, OpenEyes keeps listening again after every reply, and silence does not end the conversation.
            OpenEyes never records or saves audio. The recognized words are sent to Meta AI through the OpenEyes server to get a reply.
            Replies are spoken by your device voice; Meta Voice only turns speech into text.
          </Notice>
        </div>
        <OptionGroup<SpeechRecognitionChoice>
          legend="Speech recognition"
          name="speechRecognition"
          value={settings.speechRecognition}
          onChange={(v) =>
            set('speechRecognition', v, v === 'meta' ? 'Meta Voice speech recognition on.' : 'Browser speech recognition on.')
          }
          options={[
            {
              value: 'meta',
              label: 'Meta Voice',
              description:
                'Muse Voice Transcribe, speech-to-text via the OpenEyes server. While listening, audio is streamed there and turned into text. If it is unavailable, the browser listens instead and you are told.',
            },
            { value: 'browser', label: 'Browser', description: "Your browser's own speech recognition. In Chrome this usually runs on Google's servers." },
          ]}
        />
        <Switch
          label="Hands-free turns"
          description="After each reply, listen again by itself, until you say stop conversation or tap Stop. If the microphone keeps failing, hands-free pauses and Talk turns it back on. Turn off to tap Talk before every question."
          checked={settings.conversationHandsFree}
          onChange={(v) => set('conversationHandsFree', v, `Hands-free turns ${v ? 'on' : 'off'}.`)}
        />
        <Switch
          label={'Wake phrase "Hey OpenEyes" (experimental)'}
          description="Only answer when you start with Hey OpenEyes. Works only during a conversation you started, never in the background. Recognition may miss the phrase; the Talk button always works."
          checked={settings.conversationWakePhrase}
          onChange={(v) => set('conversationWakePhrase', v, `Wake phrase ${v ? 'on' : 'off'}.`)}
        />
        <Switch
          label="Interrupt by voice (experimental)"
          description="Keeps listening while OpenEyes speaks so you can talk over it. Works best with headphones; the speaker may be heard as you. The Talk button always interrupts."
          checked={settings.conversationBargeIn}
          onChange={(v) => set('conversationBargeIn', v, `Interrupt by voice ${v ? 'on' : 'off'}.`)}
        />
        <Switch
          label="Show voice timing details"
          description="For testing. Shows how long recognition, the reply and speech took. No words or audio are shown or kept."
          checked={settings.voiceDiagnostics}
          onChange={(v) => set('voiceDiagnostics', v, `Voice timing details ${v ? 'shown' : 'hidden'}.`)}
        />
      </Section>

      <Section title="Live Explore">
        <div className="py-3">
          <Notice variant="info" title="Camera and data use">
            Live Explore keeps the camera on until you stop, pause or leave the app. Only selected frames are shrunk and sent
            securely to Meta AI through the OpenEyes server, and they are not saved. Automatic modes use mobile data.
          </Notice>
        </div>
        <OptionGroup<ExploreMode>
          legend="Default explore mode"
          name="settings-explore-mode"
          value={settings.exploreMode}
          onChange={(v) => set('exploreMode', v, `Explore mode: ${MODE_LABELS[v]}.`)}
          options={[
            { value: 'ask', label: MODE_LABELS.ask, description: 'Nothing is sent until you ask. Recommended.' },
            { value: 'smart', label: MODE_LABELS.smart, description: 'Checks frames regularly and speaks only when the view changes.' },
            { value: 'continuous', label: MODE_LABELS.continuous, description: 'Checks frames regularly and describes each new view.' },
          ]}
        />
        <OptionGroup<string>
          legend="Time between automatic frames"
          name="explore-interval"
          columns={2}
          value={String(settings.exploreIntervalSeconds)}
          onChange={(v) => set('exploreIntervalSeconds', Number(v) as (typeof EXPLORE_INTERVALS)[number], `Every ${v} seconds.`)}
          description="Longer gaps use less data. 8 seconds is the fastest allowed."
          options={EXPLORE_INTERVALS.map((s) => ({ value: String(s), label: `${s} seconds` }))}
        />
        <OptionGroup<string>
          legend="Session limit"
          name="explore-session"
          columns={2}
          value={String(settings.exploreSessionMinutes)}
          onChange={(v) => set('exploreSessionMinutes', Number(v) as (typeof EXPLORE_SESSION_MINUTES)[number], `Sessions stop after ${v} minutes.`)}
          description="Live Explore stops by itself after this time, or after 60 frames, to protect your battery, data and privacy."
          options={EXPLORE_SESSION_MINUTES.map((m) => ({ value: String(m), label: `${m} minutes` }))}
        />
      </Section>

      <Section title="Environmental awareness" badge={<PlannedBadge label="Experimental" />}>
        <div className="py-3">
          <Notice variant="warning" title="Not a mobility aid">
            Scene announcements describe what a camera photo appears to show every so often. They can be late, wrong or
            missing. OpenEyes never says a path is clear or safe and never tells you when to move. Keep using your cane,
            guide dog and mobility training.
          </Notice>
        </div>
        <Switch
          label="Enable scene change announcements"
          description="While Live Explore runs in Smart Explore or Continuous mode, briefly mention visible changes such as a person or an open door. Off by default."
          checked={settings.sceneAlerts}
          onChange={(v) => set('sceneAlerts', v, `Scene change announcements ${v ? 'on' : 'off'}.`)}
        />
        <Switch
          label="Pause announcements"
          description="Keeps your choices but stops announcements until you turn this off."
          checked={settings.sceneAlertsPaused}
          disabled={!settings.sceneAlerts}
          onChange={(v) => set('sceneAlertsPaused', v, `Announcements ${v ? 'paused' : 'resumed'}.`)}
        />
        <OptionGroup<SceneAlertFrequency>
          legend="Announcement frequency"
          name="scene-alert-frequency"
          value={settings.sceneAlertFrequency}
          onChange={(v) => set('sceneAlertFrequency', v, 'Announcement frequency changed.')}
          description="The shortest gap between two announcements. Your questions always come first."
          options={[
            { value: 'low', label: 'Rarely', description: 'At most one every 90 seconds' },
            { value: 'medium', label: 'Sometimes', description: 'At most one every 45 seconds' },
            { value: 'high', label: 'Often', description: 'At most one every 20 seconds' },
          ]}
        />
        <OptionGroup<SceneAlertDetail>
          legend="Description detail"
          name="scene-alert-detail"
          value={settings.sceneAlertDetail}
          onChange={(v) => set('sceneAlertDetail', v, 'Announcement detail changed.')}
          options={[
            { value: 'brief', label: 'Brief', description: 'Only the change, for example "A door appears open."' },
            { value: 'detailed', label: 'Detailed', description: 'The change followed by a short description of the view' },
          ]}
        />
        <fieldset className="py-3">
          <legend className="text-lg font-bold">Alert categories</legend>
          {SCENE_ALERT_CATEGORIES.map((c) => (
            <Switch
              key={c}
              label={SCENE_CATEGORY_LABELS[c]}
              checked={settings.sceneAlertCategories.includes(c)}
              onChange={(v) =>
                set(
                  'sceneAlertCategories',
                  v ? [...settings.sceneAlertCategories, c] : settings.sceneAlertCategories.filter((x) => x !== c),
                  `${SCENE_CATEGORY_LABELS[c]} alerts ${v ? 'on' : 'off'}.`,
                )
              }
            />
          ))}
        </fieldset>
      </Section>

      <Section title="Assistant">
        <OptionGroup<ResponseLength>
          legend="Response length"
          name="response-length"
          value={settings.responseLength}
          onChange={(v) => set('responseLength', v, 'Response length changed.')}
          description="Saved now and sent with your questions once the Meta AI connection is available."
          options={[
            { value: 'brief', label: 'Brief', description: 'One or two sentences.' },
            { value: 'standard', label: 'Standard', description: 'A short paragraph.' },
            { value: 'detailed', label: 'Detailed', description: 'Full descriptions.' },
          ]}
        />
      </Section>

      <Section title="Proactive assistance" badge={<PlannedBadge label="Configuration only" />}>
        <div className="py-3">
          <Notice variant="info" title="Planned feature">
            OpenEyes does not watch your surroundings or make announcements on its own yet. These choices are saved so they
            are ready when proactive assistance is built.
          </Notice>
        </div>
        <OptionGroup<AssistanceMode>
          legend="Assistance mode"
          name="assistance-mode"
          value={settings.assistanceMode}
          onChange={(v) => set('assistanceMode', v, 'Assistance mode changed.')}
          options={[
            { value: 'reactive', label: 'Reactive only', description: 'OpenEyes responds only when you ask.' },
            {
              value: 'reactive-proactive',
              label: 'Reactive and proactive',
              description: 'OpenEyes may offer helpful announcements when enabled.',
              badge: <PlannedBadge />,
            },
          ]}
        />
        <OptionGroup<ProactiveFrequency>
          legend="Proactive announcement frequency"
          name="proactive-frequency"
          columns={2}
          value={settings.proactiveFrequency}
          onChange={(v) => set('proactiveFrequency', v, 'Frequency changed.')}
          description={proactive ? undefined : 'Turn on reactive and proactive mode to choose a frequency.'}
          options={(['low', 'medium', 'high'] as const).map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
            disabled: !proactive,
          }))}
        />
        <Switch
          label="Quiet mode"
          description="Silences spoken replies and future proactive announcements."
          checked={settings.quietMode}
          onChange={(v) => set('quietMode', v, `Quiet mode ${v ? 'on' : 'off'}.`)}
        />
        <div className="py-3">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              tts.stop();
              updateSettings({ quietMode: true });
              announce('Announcements stopped. Quiet mode is on.');
            }}
          >
            <VolumeX aria-hidden="true" className="h-5 w-5" /> Stop announcements
          </button>
        </div>
      </Section>

      <Section title="Privacy">
        <Switch
          label="Remember conversation"
          description="Keep your Assistant conversation on this device after you close the app. Off means it is cleared when you leave."
          checked={settings.rememberConversation}
          onChange={(v) => set('rememberConversation', v, `Remember conversation ${v ? 'on' : 'off'}.`)}
        />
        <div className="space-y-3 py-3 text-ink/90">
          <p>
            <strong>Kept on this device only:</strong> settings, memories, Trusted Circle contacts, and your Assistant conversation
            if Remember conversation is on. These are never uploaded as a whole.
          </p>
          <p>
            <strong>Sent to the OpenEyes server, then to Meta AI:</strong> your typed or recognized question; a shrunk camera frame
            when you press Describe, Find, Read or send a photo, and selected frames while Live Explore runs; recent conversation
            messages; and only the saved memories that match your question. The OpenEyes server passes these to Meta and does not
            store them.
          </p>
          <p>
            <strong>Microphone audio:</strong> sent only while a voice conversation is listening. With Meta Voice it streams through
            the OpenEyes server to Meta Voice Transcribe. With browser recognition, your browser maker may process it. OpenEyes
            never records or stores audio or transcripts on its server.
          </p>
          <p>
            <strong>What the OpenEyes server keeps:</strong> for usage limits, a scrambled device identifier, request times and
            voice session lengths, removed after 24 hours. Its logs contain error types and session lengths, not your words,
            images or memories.
          </p>
          <p>
            <strong>Meta:</strong> Meta processes what OpenEyes sends under its own terms. OpenEyes cannot promise how long Meta keeps
            it.
          </p>
        </div>
        <div className="py-3">
          <button type="button" className="btn-danger w-full" onClick={() => setConfirmWipe(true)}>
            Delete all OpenEyes data on this device
          </button>
        </div>
      </Section>

      <Section title="Camera and microphone permissions">
        <div className="space-y-2 py-3 text-ink/90">
          <p>
            <strong>Camera:</strong> requested only when you press Turn on camera or Start exploring. Single-photo screens turn
            the camera off when you capture a photo or leave the screen. Live Explore turns it off when you stop, when the
            session limit is reached or when OpenEyes leaves the screen.
          </p>
          <p>
            <strong>Photos and AI:</strong> a photo leaves this device only when you press a button such as Describe,
            Find, Read or Send with a photo attached, or while Live Explore is running. It is shrunk and sent to Meta AI
            through the OpenEyes server, and OpenEyes does not store it there.
          </p>
          <p>
            <strong>Microphone:</strong> requested only when you start voice input or a voice conversation, and used only while
            listening. A voice conversation stops when you leave the screen or switch apps.
          </p>
          <p>To revoke access, open your browser&apos;s site settings or your phone&apos;s app permissions.</p>
        </div>
      </Section>

      <Section title="Meta AI models">
        <ul className="space-y-3 py-3">
          {META_MODELS.map((m) => (
            <li key={m.id}>
              <p className="flex flex-wrap items-center gap-2 font-bold">
                {m.name}
                <PlannedBadge label={m.status === 'integrated' ? 'Via OpenEyes server' : 'Planned'} />
              </p>
              <p className="text-muted">{m.use}</p>
            </li>
          ))}
        </ul>
        <p className="py-3 text-sm text-muted">
          Muse Spark and Muse Voice Transcribe answer only when the OpenEyes server has a Meta API key; use the connection check
          below to see whether it is reachable now. Models marked Planned are not connected.
        </p>
        <MetaConnectionCheck />
      </Section>

      <Section title="Voice diagnostics" badge={<PlannedBadge label="Testing" />}>
        <VoiceDiagnosticsPanel />
      </Section>

      <Section title="App & updates">
        <AppUpdatesPanel />
      </Section>

      <button type="button" className="btn-secondary mt-6 w-full" onClick={() => setConfirmReset(true)}>
        Reset all settings
      </button>

      <ConfirmDialog
        open={confirmReset}
        title="Reset settings?"
        message="All settings return to their defaults. Your memories and contacts are kept."
        confirmLabel="Reset settings"
        onConfirm={() => {
          resetSettings();
          setConfirmReset(false);
          announce('Settings reset.');
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmWipe}
        title="Delete all data?"
        message="This permanently deletes your memories, Trusted Circle contacts, conversation and settings from this device."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => {
          clearAllAppData();
          resetSettings();
          setConfirmWipe(false);
          announce('All OpenEyes data deleted from this device.');
        }}
        onCancel={() => setConfirmWipe(false)}
      />
    </>
  );
}
