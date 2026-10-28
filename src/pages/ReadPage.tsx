import { useCallback, useId, useState } from 'react';
import { BookOpenText, Pause, Play, ScanText, Square } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { Notice } from '../components/Notice';
import { AIPending } from '../components/AIResult';
import { useAIRequest } from '../hooks/useAIRequest';
import type { TextReadingResult } from '../types/ai';
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
  const request = useAIRequest<TextReadingResult>();
  const { reset } = request;
  const visionStatus = vision.getStatus();
  const hasText = text.trim().length > 0;
  const pending = request.state.status === 'pending';

  const onImageChange = useCallback(
    (next: CapturedImage | null) => {
      setImage(next);
      reset();
    },
    [reset],
  );

  const readFromPhoto = async () => {
    if (!image) return;
    tts.stop();
    const result = await request.run(
      (signal) => vision.readText(image, { signal }),
      'Reading text from your photo. This can take a few seconds.',
    );
    if (!result) return;
    if (result.readable) {
      setText(result.text.slice(0, LIMITS.readText));
      const lines = result.text.split('\n').filter((l) => l.trim()).length;
      announce(`Text found, ${lines} ${lines === 1 ? 'line' : 'lines'}. It is in the text box below. Press Read aloud to hear it.`);
    } else {
      announce('No readable text was found in this photo.');
    }
  };

  return (
    <>
      <PageHeader
        title="Read"
        icon={<BookOpenText className="h-7 w-7" />}
        description="Capture or choose a photo of text, or paste text to have it read aloud."
      />

      <CameraCapture subject="text to read" allowUpload onImageChange={onImageChange} />

      <button
        type="button"
        className="btn-primary mt-4 w-full text-lg"
        disabled={!image || !visionStatus.available || pending}
        onClick={() => void readFromPhoto()}
      >
        <ScanText aria-hidden="true" className="h-6 w-6" /> Read text from photo
      </button>
      {!visionStatus.available && (
        <div className="mt-3">
          <Notice variant="warning" title="Reading text from photos not available yet">
            OpenEyes cannot read text from photos in this version of the app because Meta AI is not connected. You can
            still paste or type text below and have it read aloud.
          </Notice>
        </div>
      )}

      {pending && <AIPending label="Reading text from your photo" onCancel={request.cancel} />}
      {request.state.status === 'error' && (
        <div className="mt-4">
          <Notice variant="error" title="Could not read the photo">
            {request.state.message}
          </Notice>
        </div>
      )}
      {request.state.status === 'success' && !request.state.result.readable && (
        <div className="mt-4">
          <Notice variant="info" title="No readable text found">
            OpenEyes could not find any text it could read with confidence. Try more light, hold the phone steady, or
            move closer so the text fills more of the photo.
          </Notice>
        </div>
      )}
      {request.state.status === 'success' && request.state.result.readable && (
        <div className="mt-4">
          <Notice variant="success" title="Text found">
            The text from your photo is in the box below. Parts marked [unreadable] could not be read. Text read by AI can
            contain mistakes, so check important details such as medicine doses with a trusted person.
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
