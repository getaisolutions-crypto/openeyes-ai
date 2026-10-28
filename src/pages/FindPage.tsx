import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Search } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { MicButton } from '../components/MicButton';
import { Notice } from '../components/Notice';
import { AIPending } from '../components/AIResult';
import { FindResultCard, describeFindResult } from '../components/FindResultCard';
import { useServices } from '../services/ServicesContext';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useAIRequest } from '../hooks/useAIRequest';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import type { ObjectDetectionResult } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import type { Memory } from '../types/memory';
import { LIMITS, cleanText } from '../utils/validation';

const SUGGESTIONS = ['Keys', 'Wallet', 'Phone', 'Water bottle', 'Glasses'];

export default function FindPage() {
  const { objectDetection, memory } = useServices();
  const { announce } = useAnnouncer();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [related, setRelated] = useState<Memory[]>([]);
  const request = useAIRequest<ObjectDetectionResult>();
  const { reset } = request;
  const speech = useSpeechRecognition({ onFinal: (text) => setQuery(text.slice(0, LIMITS.objectQuery)) });
  const detection = objectDetection.getStatus();
  const term = cleanText(query);
  const pending = request.state.status === 'pending';

  useEffect(() => reset(), [term, reset]);

  const onImageChange = useCallback(
    (next: CapturedImage | null) => {
      setImage(next);
      reset();
    },
    [reset],
  );

  const find = async () => {
    if (!image || !term) return;
    const result = await request.run(
      (signal) => objectDetection.findObject(term, image, { signal }),
      `Looking for ${term} in your photo. This can take a few seconds.`,
    );
    if (result) announce(describeFindResult(result));
  };

  useEffect(() => {
    let cancelled = false;
    if (!term) {
      setRelated([]);
      return;
    }
    memory
      .search(term)
      .then((results) => !cancelled && setRelated(results.slice(0, 5)))
      .catch(() => !cancelled && setRelated([]));
    return () => {
      cancelled = true;
    };
  }, [term, memory]);

  return (
    <>
      <PageHeader
        title="Find"
        icon={<Search className="h-7 w-7" />}
        description="Tell OpenEyes what you are looking for."
      />

      {detection.available ? (
        <Notice variant="info" title="How Find works">
          OpenEyes looks at one photo with Meta AI and tells you whether the item seems to be there and roughly where. It
          cannot measure distance. Find also shows anything you saved in My Memories about the item.
        </Notice>
      ) : (
        <Notice variant="warning" title="Object detection not available yet">
          OpenEyes cannot look for objects in photos in this version of the app because Meta AI is not connected. Find
          still shows anything you have saved in My Memories about the item.
        </Notice>
      )}

      <section aria-label="Item to find" className="card mt-4 p-5">
        <label htmlFor={inputId} className="label text-lg">
          What are you looking for?
        </label>
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            type="text"
            value={query}
            maxLength={LIMITS.objectQuery}
            onChange={(e) => setQuery(e.target.value)}
            className="field text-lg"
            placeholder="For example, keys"
            autoComplete="off"
          />
          {speech.supported && (
            <MicButton
              size="md"
              listening={speech.listening}
              onStart={speech.start}
              onStop={speech.stop}
              idleLabel="Say the item name"
            />
          )}
        </div>
        {speech.error && (
          <p role="alert" className="mt-2 font-bold text-danger">
            {SPEECH_ERROR_MESSAGES[speech.error]}
          </p>
        )}
        <div className="mt-4" role="group" aria-label="Common items">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setQuery(item)}
                aria-pressed={term.toLowerCase() === item.toLowerCase()}
                className="min-h-[48px] rounded-full border border-line bg-surface-2 px-4 font-bold transition-colors hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/15"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {term && (
        <section aria-labelledby="related-heading" aria-live="polite" className="card mt-4 p-5">
          <h2 id="related-heading" className="flex items-center gap-2 text-xl font-bold">
            <Brain aria-hidden="true" className="h-6 w-6 text-primary" /> From your memories
          </h2>
          <p className="mt-1 text-sm text-muted">Notes you saved earlier. They are not what the camera sees now.</p>
          {related.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {related.map((m) => (
                <li key={m.id} className="rounded-xl bg-surface-2 p-3 text-lg">
                  {m.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">
              No saved memories mention &ldquo;{term}&rdquo;.{' '}
              <Link to="/memory" className="font-bold text-primary underline underline-offset-4">
                Add a memory
              </Link>
            </p>
          )}
        </section>
      )}

      <div className="mt-4">
        <CameraCapture subject="the area to search" onImageChange={onImageChange} />
      </div>
      <button
        type="button"
        className="btn-primary mt-4 w-full text-lg"
        disabled={!detection.available || !image || !term || pending}
        onClick={() => void find()}
      >
        <Search aria-hidden="true" className="h-6 w-6" /> Find {term || 'item'} in photo
      </button>
      {!detection.available && <p className="mt-2 text-center text-muted">Photo search is not available yet.</p>}
      {detection.available && (!image || !term) && (
        <p className="mt-2 text-center text-muted">
          {!term ? 'Choose or say an item first.' : 'Take a photo of the area to search.'}
        </p>
      )}

      {pending && <AIPending label={`Looking for ${term}`} onCancel={request.cancel} />}

      {request.state.status === 'error' && (
        <div className="mt-4">
          <Notice variant="error" title="Could not search the photo">
            {request.state.message}
          </Notice>
        </div>
      )}

      {request.state.status === 'success' && <FindResultCard result={request.state.result} />}
    </>
  );
}
