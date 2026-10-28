import { useEffect, useId, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useSettings } from '../hooks/useSettings';
import type { VoiceOption } from '../types/voice';

/** Picks one of the device's built-in voices. Browsers load voices late, so the list refreshes on focus. */
export function VoiceSelect() {
  const { voice } = useServices();
  const { settings, updateSettings } = useSettings();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const id = useId();

  useEffect(() => setVoices(voice.getVoices()), [voice]);

  return (
    <div>
      <label htmlFor={id} className="text-lg font-bold">
        Voice
      </label>
      <select
        id={id}
        className="field mt-2 w-full"
        value={settings.voiceURI}
        onFocus={() => setVoices(voice.getVoices())}
        onChange={(e) => updateSettings({ voiceURI: e.target.value })}
      >
        <option value="">Device default voice</option>
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
      <p className="mt-1 text-sm text-muted">Voices built into your phone or browser. They are not neural or Meta voices.</p>
    </div>
  );
}
