import { CameraError, type CameraProvider, type CapturedImage } from '../../types/camera';

export function toCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('permission-denied', 'Camera access was blocked.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera is being used by another app or could not start.');
    default:
      return new CameraError('unknown', 'The camera could not be started.');
  }
}

/** Phone camera via getUserMedia. Frames are only captured on explicit user action and stay on the device. */
export function createBrowserCameraProvider(): CameraProvider {
  return {
    source: 'phone',
    isSupported: () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),

    async start({ facingMode = 'environment' } = {}) {
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        throw new CameraError('insecure-context', 'The camera only works on a secure (https) connection.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new CameraError('unsupported', 'This browser does not support camera access.');
      }
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (error) {
        throw toCameraError(error);
      }
    },

    stop(stream) {
      stream?.getTracks().forEach((track) => track.stop());
    },

    capture(video) {
      return new Promise<CapturedImage>((resolve, reject) => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
          reject(new CameraError('unknown', 'The camera is not ready yet. Try again in a moment.'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new CameraError('unknown', 'Could not capture the image.'));
          return;
        }
        context.drawImage(video, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new CameraError('unknown', 'Could not capture the image.'));
              return;
            }
            resolve({
              blob,
              previewUrl: URL.createObjectURL(blob),
              width,
              height,
              capturedAt: new Date().toISOString(),
              source: 'phone',
            });
          },
          'image/jpeg',
          0.9,
        );
      });
    },
  };
}
