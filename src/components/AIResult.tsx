import { Loader2, Pause, Play, ShieldAlert, Square, X } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAnnouncer } from '../hooks/useAnnouncer';

export function AIPending({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <p role="status" className="flex items-center gap-2 font-bold">
        <Loader2 aria-hidden="true" className="h-6 w-6 text-primary motion-safe:animate-spin" />
        {label}
      </p>
      <button type="button" className="btn-secondary" onClick={onCancel}>
        <X aria-hidden="true" className="h-5 w-5" /> Cancel
      </button>
    </div>
  );
}

/** Read aloud / pause / resume / stop for an AI answer. Never starts speaking on its own. */
export function SpeechControls({ text }: { text: string }) {
  const tts = useSpeechSynthesis();
  const { announce } = useAnnouncer();
  if (!tts.supported) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {tts.state === 'speaking' ? (
        <button type="button" className="btn-secondary" onClick={tts.pause}>
          <Pause aria-hidden="true" className="h-5 w-5" /> Pause
        </button>
      ) : tts.state === 'paused' ? (
        <button type="button" className="btn-secondary" onClick={tts.resume}>
          <Play aria-hidden="true" className="h-5 w-5" /> Resume
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            tts.speak(text);
            announce('Reading aloud.');
          }}
        >
          <Play aria-hidden="true" className="h-5 w-5" /> Read aloud
        </button>
      )}
      <button type="button" className="btn-secondary" disabled={tts.state === 'idle'} onClick={tts.stop}>
        <Square aria-hidden="true" className="h-5 w-5" /> Stop
      </button>
    </div>
  );
}

export function SafetyNote() {
  return (
    <p className="mt-4 flex gap-2 text-sm text-muted">
      <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <span>
        AI descriptions can be wrong and only reflect what the camera captured. Directions such as left or right mean
        the side of the camera view, and distances are not measured. Do not use them to judge traffic, steps, drop-offs
        or obstacles. Keep using your cane, guide dog or mobility skills.
      </span>
    </p>
  );
}
