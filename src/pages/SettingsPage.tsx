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
import { SPEECH_RATE } from '../services/settings/settingsStorage';
import { META_MODELS } from '../services/ai/metaModels';
import { MetaConnectionCheck } from '../components/MetaConnectionCheck';
import { clearAllAppData } from '../utils/storage';
import type { AssistanceMode, ProactiveFrequency, TextSize, Theme } from '../types/settings';
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
        <div className="space-y-2 py-3 text-ink/90">
          <p>In this version nothing you save, say or photograph is sent to OpenEyes or Meta servers.</p>
          <p>Voice input uses your browser&apos;s speech service, which may process audio online depending on the browser.</p>
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
            <strong>Camera:</strong> requested only when you press Turn on camera on Explore, Find or Read. The camera turns
            off when you capture a photo or leave the screen.
          </p>
          <p>
            <strong>Photos and AI:</strong> a photo leaves this device only when you press a button such as Describe,
            Find, Read or Send with a photo attached. It is shrunk and sent to Meta AI through the OpenEyes server, and
            OpenEyes does not store it there.
          </p>
          <p>
            <strong>Microphone:</strong> requested only when you start voice input, and used only while listening.
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
          Muse Spark answers only when the OpenEyes server has a Meta API key. The other models are not connected yet.
        </p>
        <MetaConnectionCheck />
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
