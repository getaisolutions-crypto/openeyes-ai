import { useId, useState } from 'react';
import { BookOpenText, Pause, Play, ScanText, Square } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { Notice } from '../components/Notice';
import { useServices } from '../services/ServicesContext';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import type { CapturedImage } from '../types/camera';
import { LIMITS } from '../utils/validation';

export default function ReadPage() {
  const { vision } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const tts = useSpeechSynthesis();
  const textId = useId();
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [text, setText] = useState('');
  const visionStatus = vision.getStatus();
  const hasText = text.trim().length > 0;

  return (
    <>
      <PageHeader
        title="Read"
        icon={<BookOpenText className="h-7 w-7" />}
        description="Capture or choose a photo of text, or paste text to have it read aloud."
      />

      <CameraCapture subject="text to read" allowUpload onImageChange={setImage} />

      <button type="button" className="btn-primary mt-4 w-full text-lg" disabled={!image || !visionStatus.available}>
        <ScanText aria-hidden="true" className="h-6 w-6" /> Read text from photo
      </button>
      {!visionStatus.available && (
        <div className="mt-3">
          <Notice variant="warning" title="Reading text from photos not available yet">
            OpenEyes cannot yet read text from photos. That needs the Meta AI connection planned for the next phase. You
            can still paste or type text below and have it read aloud.
          </Notice>
        </div>
      )}

      <section aria-labelledby="read-aloud-heading" className="card mt-6 p-5">
        <h2 id="read-aloud-heading" className="text-xl font-bold">
          Read aloud
        </h2>
        <label htmlFor={textId} className="label mt-3">
          Text
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.readText}
          rows={6}
          className="field text-lg"
          placeholder="Paste or type text here"
        />
        {tts.supported ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tts.state === 'speaking' ? (
                <button type="button" className="btn-primary" onClick={tts.pause}>
                  <Pause aria-hidden="true" className="h-5 w-5" /> Pause
                </button>
              ) : tts.state === 'paused' ? (
                <button type="button" className="btn-primary" onClick={tts.resume}>
                  <Play aria-hidden="true" className="h-5 w-5" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!hasText}
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
            <p className="mt-3 text-sm text-muted">
              Speech rate {settings.speechRate.toFixed(1)}x. Change it in Settings. Reading uses your device&apos;s built-in voice.
            </p>
          </>
        ) : (
          <div className="mt-4">
            <Notice variant="info" title="Read aloud not supported">
              This browser does not support speech output. Your screen reader can still read the text above.
            </Notice>
          </div>
        )}
      </section>
    </>
  );
}
