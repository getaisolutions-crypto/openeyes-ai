import { useCallback, useState } from 'react';
import { ScanEye, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { Notice } from '../components/Notice';
import { AIPending, SafetyNote, SpeechControls } from '../components/AIResult';
import { useServices } from '../services/ServicesContext';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useAIRequest } from '../hooks/useAIRequest';
import type { SceneDescription } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import { formatDateTime } from '../utils/format';

export default function ExplorePage() {
  const { vision } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const request = useAIRequest<SceneDescription>();
  const { reset } = request;
  const [image, setImage] = useState<CapturedImage | null>(null);
  const status = vision.getStatus();
  const pending = request.state.status === 'pending';

  const onImageChange = useCallback(
    (next: CapturedImage | null) => {
      setImage(next);
      reset();
    },
    [reset],
  );

  const describe = async () => {
    if (!image) return;
    const result = await request.run(
      (signal) => vision.describeScene(image, { responseLength: settings.responseLength, signal }),
      'Describing your photo. This can take a few seconds.',
    );
    if (result) announce(`Description: ${result.summary}`);
  };

  return (
    <>
      <PageHeader
        title="Explore"
        icon={<ScanEye className="h-7 w-7" />}
        description="Take a photo of what is around you and OpenEyes will describe it."
      />

      <CameraCapture subject="your surroundings" onImageChange={onImageChange} />

      <div className="mt-4 space-y-4">
        <button
          type="button"
          className="btn-primary w-full text-lg"
          disabled={!image || !status.available || pending}
          onClick={() => void describe()}
        >
          <Sparkles aria-hidden="true" className="h-6 w-6" />
          {request.state.status === 'success' ? 'Describe again' : 'Describe my surroundings'}
        </button>
        {!status.available && (
          <Notice variant="warning" title="Scene description not available yet">
            {image
              ? 'Your photo is ready, but OpenEyes cannot describe it yet because image understanding is not connected. The photo stayed on your device.'
              : 'Taking photos works today. Describing them requires the Meta AI connection, which is not set up in this version of the app.'}
          </Notice>
        )}
      </div>

      {pending && <AIPending label="Describing your photo" onCancel={request.cancel} />}

      {request.state.status === 'error' && (
        <div className="mt-4">
          <Notice variant="error" title="Could not describe the photo">
            {request.state.message}
          </Notice>
        </div>
      )}

      {request.state.status === 'success' && image && (
        <section aria-labelledby="scene-heading" className="card mt-4 p-5 animate-fade-up">
          <h2 id="scene-heading" className="text-xl font-bold">
            What OpenEyes sees
          </h2>
          <p className="mt-1 text-sm text-muted">From your photo taken {formatDateTime(image.capturedAt)}</p>
          <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed">{request.state.result.summary}</p>
          <SpeechControls text={request.state.result.summary} />
          <SafetyNote />
        </section>
      )}
    </>
  );
}
