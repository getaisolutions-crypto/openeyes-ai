import { useCallback, useId, useRef, useState } from 'react';
import { BookOpenText, Eraser, Pause, Play, RotateCcw, ScanText, Square, Zap } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { Notice } from '../components/Notice';
import { AIPending } from '../components/AIResult';
import { QuickReadCard } from '../components/read/QuickReadCard';
import { DocumentQuestions } from '../components/read/DocumentQuestions';
import { useAIRequest } from '../hooks/useAIRequest';
import { useReadingSession } from '../hooks/useReadingSession';
import type { QuickReadResult, TextReadingResult } from '../types/ai';
import { phraseQuickRead } from '../services/read/readingSession';
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
  const [cameraKey, setCameraKey] = useState(0);
  const lastExtracted = useRef('');
  const request = useAIRequest<TextReadingResult>();
  const quickRequest = useAIRequest<QuickReadResult>();
  const { reset } = request;
  const resetQuick = quickRequest.reset;
  const session = useReadingSession(image, text);
  const visionStatus = vision.getStatus();
  const hasText = text.trim().length > 0;
  const pending = request.state.status === 'pending' || quickRequest.state.status === 'pending';

  const speakIfEnabled = (spoken: string) => {
    if (settings.voiceOutput) tts.speak(spoken);
  };

  const onImageChange = useCallback(
    (next: CapturedImage | null) => {
      setImage(next);
      reset();
      resetQuick();
    },
    [reset, resetQuick],
  );

  const quickRead = async () => {
    if (!image) return;
    tts.stop();
    request.reset();
    const result = await quickRequest.run(
      (signal) => vision.quickRead(image, { signal }),
      'Quick reading your photo. This can take a few seconds.',
    );
    if (!result) return;
    session.setQuick(result);
    const spoken = phraseQuickRead(result);
    if (result.readable) lastExtracted.current = result.keyText;
    announce(spoken);
    speakIfEnabled(spoken);
  };

  const readAgain = () => {
    const again = text.trim() || lastExtracted.current;
    if (!again) return;
    tts.speak(again);
    announce('Reading again.');
  };

  const ask = async (question: string) => {
    tts.stop();
    const reply = await session.ask(question);
    if (reply) {
      announce(reply);
      speakIfEnabled(reply);
    }
  };

  const clearSession = () => {
    tts.stop();
    session.reset();
    request.reset();
    quickRequest.reset();
    setText('');
    lastExtracted.current = '';
    setImage(null);
    setCameraKey((k) => k + 1);
    announce('Reading session cleared. The photo and text were removed from this screen.');
  };

  const readFromPhoto = async () => {
    if (!image) return;
    tts.stop();
    quickRequest.reset();
    const result = await request.run(
      (signal) => vision.readText(image, { signal }),
      'Reading text from your photo. This can take a few seconds.',
    );
    if (!result) return;
    if (result.readable) {
      setText(result.text.slice(0, LIMITS.readText));
      lastExtracted.current = result.text;
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

      <CameraCapture key={cameraKey} subject="text to read" allowUpload onImageChange={onImageChange} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="btn-secondary text-lg"
          disabled={!image || !visionStatus.available || pending}
          onClick={() => void quickRead()}
        >
          <Zap aria-hidden="true" className="h-6 w-6" /> Quick read
        </button>
        <button
          type="button"
          className="btn-primary text-lg"
          disabled={!image || !visionStatus.available || pending}
          onClick={() => void readFromPhoto()}
        >
          <ScanText aria-hidden="true" className="h-6 w-6" /> Read text from photo
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Quick read gives the most important text. Read text from photo is the full read, in order.
      </p>
      {!visionStatus.available && (
        <div className="mt-3">
          <Notice variant="warning" title="Reading text from photos not available yet">
            OpenEyes cannot read text from photos in this version of the app because Meta AI is not connected. You can
            still paste or type text below and have it read aloud.
          </Notice>
        </div>
      )}

      {quickRequest.state.status === 'pending' && <AIPending label="Quick reading your photo" onCancel={quickRequest.cancel} />}
      {quickRequest.state.status === 'error' && (
        <div className="mt-4">
          <Notice variant="error" title="Could not read the photo">
            {quickRequest.state.message}
          </Notice>
        </div>
      )}
      {quickRequest.state.status === 'success' && <QuickReadCard result={quickRequest.state.result} />}
      {request.state.status === 'pending' && <AIPending label="Reading text from your photo" onCancel={request.cancel} />}
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

      {visionStatus.available && (
        <DocumentQuestions
          turns={session.turns}
          asking={session.asking}
          error={session.error}
          disabled={!image}
          onAsk={(q) => void ask(q)}
          onCancel={session.cancel}
        />
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
              <button
                type="button"
                className="btn-secondary"
                disabled={!hasText && !lastExtracted.current}
                onClick={readAgain}
              >
                <RotateCcw aria-hidden="true" className="h-5 w-5" /> Read again
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

      <section aria-labelledby="reading-privacy-heading" className="card mt-4 p-5">
        <h2 id="reading-privacy-heading" className="text-xl font-bold">
          Reading privacy
        </h2>
        <p className="mt-1 text-muted">
          Document photos, text and answers stay on this screen only. They are not saved, and they are removed when you
          leave Read or clear the session. A photo is only sent to Meta AI when you press a read or ask button.
        </p>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={clearSession}>
          <Eraser aria-hidden="true" className="h-5 w-5" /> Clear reading session
        </button>
      </section>
    </>
  );
}
