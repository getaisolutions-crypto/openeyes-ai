import { Pause, Play, Square } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import type { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { SPEECH_RATE } from '../../services/settings/settingsStorage';
import { VoiceSelect } from '../VoiceSelect';

interface Props {
  speech: ReturnType<typeof useSpeechSynthesis>;
}

/** Stop, pause and resume speech, plus rate and voice. Changes are saved as settings. */
export function LiveSpeechControls({ speech }: Props) {
  const { settings, updateSettings } = useSettings();

  if (!speech.supported) {
    return <p className="text-muted">Spoken replies are not supported in this browser. Replies appear in the transcript.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {speech.state === 'paused' ? (
          <button type="button" className="btn-secondary" onClick={speech.resume}>
            <Play aria-hidden="true" className="h-5 w-5" /> Resume speech
          </button>
        ) : (
          <button type="button" className="btn-secondary" disabled={speech.state !== 'speaking'} onClick={speech.pause}>
            <Pause aria-hidden="true" className="h-5 w-5" /> Pause speech
          </button>
        )}
        <button type="button" className="btn-secondary" disabled={speech.state === 'idle'} onClick={speech.stop}>
          <Square aria-hidden="true" className="h-5 w-5" /> Stop speech
        </button>
      </div>

      <div>
        <label htmlFor="live-speech-rate" className="text-lg font-bold">
          Speech rate: {settings.speechRate.toFixed(1)}x
        </label>
        <input
          id="live-speech-rate"
          type="range"
          min={SPEECH_RATE.min}
          max={SPEECH_RATE.max}
          step={SPEECH_RATE.step}
          value={settings.speechRate}
          aria-valuetext={`${settings.speechRate.toFixed(1)} times normal speed`}
          onChange={(e) => updateSettings({ speechRate: Number(e.target.value) })}
          className="mt-2 h-12 w-full cursor-pointer accent-[rgb(var(--primary))]"
        />
      </div>

      <VoiceSelect />
    </div>
  );
}
