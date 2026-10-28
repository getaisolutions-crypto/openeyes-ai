import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, ImagePlus, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { CameraErrorKind, CapturedImage } from '../types/camera';
import { useCamera } from '../hooks/useCamera';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { ImageUploadError, imageFromFile } from '../services/camera/imageUpload';
import { Notice } from './Notice';

const CAMERA_ERRORS: Record<CameraErrorKind, { title: string; body: string }> = {
  unsupported: { title: 'Camera not supported', body: 'This browser cannot use the camera. Try Chrome on Android.' },
  'insecure-context': {
    title: 'Camera unavailable',
    body: 'The camera only works when OpenEyes is opened over a secure https connection.',
  },
  'permission-denied': {
    title: 'Camera permission denied',
    body: 'Camera access is blocked. To use it, allow the camera for this site in your browser or phone settings, then try again.',
  },
  'not-found': { title: 'No camera found', body: 'OpenEyes could not find a camera on this device.' },
  'in-use': {
    title: 'Camera busy',
    body: 'The camera may be in use by another app. Close other camera apps and try again.',
  },
  unknown: { title: 'Camera problem', body: 'The camera could not be started. Please try again.' },
};

interface CameraCaptureProps {
  /** Used in button labels, e.g. "surroundings" or "text". */
  subject: string;
  allowUpload?: boolean;
  onImageChange: (image: CapturedImage | null) => void;
}

export function CameraCapture({ subject, allowUpload = false, onImageChange }: CameraCaptureProps) {
  const camera = useCamera();
  const { announce } = useAnnouncer();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onImageChange);
  onChangeRef.current = onImageChange;

  useEffect(() => {
    onChangeRef.current(camera.image);
  }, [camera.image]);

  useEffect(() => {
    if (camera.status === 'live') announce('Camera is on. Point your phone and press Capture photo.');
    if (camera.status === 'captured') announce('Photo captured. It is stored only on this device.');
    if (camera.status === 'error' && camera.errorKind) announce(CAMERA_ERRORS[camera.errorKind].title, 'assertive');
  }, [camera.status, camera.errorKind, announce]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      camera.setUploadedImage(await imageFromFile(file));
    } catch (error) {
      const message = error instanceof ImageUploadError ? error.message : 'That photo could not be opened.';
      setUploadError(message);
      announce(message, 'assertive');
    }
  };

  return (
    <section aria-label={`Camera for ${subject}`} className="card overflow-hidden">
      <div className="relative aspect-[4/3] w-full bg-black">
        {camera.status === 'live' || camera.status === 'requesting' ? (
          <video
            ref={camera.videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            aria-label="Live camera preview"
          />
        ) : camera.status === 'captured' && camera.image ? (
          <img src={camera.image.previewUrl} alt={`Your photo of ${subject}`} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-white/80">
            <div>
              <Camera aria-hidden="true" className="mx-auto h-12 w-12" />
              <p className="mt-2">Camera is off. Nothing is being recorded.</p>
            </div>
          </div>
        )}
        {camera.status === 'requesting' && (
          <div role="status" className="absolute inset-0 grid place-items-center bg-black/70 text-white">
            <span className="flex items-center gap-2 font-bold">
              <Loader2 aria-hidden="true" className="h-6 w-6 motion-safe:animate-spin" />
              Waiting for camera permission
            </span>
          </div>
        )}
        {camera.status === 'live' && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-sm font-bold text-white">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-red-500" />
            Camera on
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        {camera.status === 'error' && camera.errorKind && (
          <Notice variant="error" title={CAMERA_ERRORS[camera.errorKind].title}>
            {CAMERA_ERRORS[camera.errorKind].body}
          </Notice>
        )}
        {uploadError && (
          <Notice variant="error" title="Photo not added">
            {uploadError}
          </Notice>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          {camera.status === 'live' ? (
            <>
              <button type="button" className="btn-primary flex-1 text-lg" onClick={camera.capture}>
                <Camera aria-hidden="true" className="h-6 w-6" /> Capture photo
              </button>
              <button type="button" className="btn-secondary" onClick={camera.stop}>
                <X aria-hidden="true" className="h-5 w-5" /> Turn camera off
              </button>
            </>
          ) : camera.status === 'captured' ? (
            <>
              <button type="button" className="btn-secondary flex-1" onClick={camera.retake}>
                <RotateCcw aria-hidden="true" className="h-5 w-5" /> Retake photo
              </button>
              <button type="button" className="btn-secondary" onClick={camera.discard}>
                <Trash2 aria-hidden="true" className="h-5 w-5" /> Remove photo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary flex-1 text-lg"
              onClick={camera.start}
              disabled={camera.status === 'requesting'}
            >
              <Camera aria-hidden="true" className="h-6 w-6" />
              {camera.status === 'error' ? 'Try camera again' : 'Turn on camera'}
            </button>
          )}
          {allowUpload && camera.status !== 'live' && (
            <>
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
                <ImagePlus aria-hidden="true" className="h-5 w-5" /> Choose a photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose a photo from this device"
                onChange={onFile}
              />
            </>
          )}
        </div>
        <p className="text-sm text-muted">Source: Phone camera. Photos stay on this device and are never uploaded.</p>
      </div>
    </section>
  );
}
