import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraError, type CameraErrorKind, type CapturedImage } from '../types/camera';
import { useServices } from '../services/ServicesContext';
import { toCameraError } from '../services/camera/browserCameraProvider';

export type CameraStatus = 'idle' | 'requesting' | 'live' | 'captured' | 'error';

export function useCamera() {
  const { camera } = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorKind, setErrorKind] = useState<CameraErrorKind | null>(null);
  const [image, setImage] = useState<CapturedImage | null>(null);

  const stopStream = useCallback(() => {
    camera.stop(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [camera]);

  const replaceImage = useCallback((next: CapturedImage | null) => {
    setImage((prev) => {
      if (prev && prev.previewUrl !== next?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    setErrorKind(null);
    replaceImage(null);
    if (!camera.isSupported()) {
      setErrorKind('unsupported');
      setStatus('error');
      return;
    }
    setStatus('requesting');
    try {
      const stream = await camera.start({ facingMode: 'environment' });
      streamRef.current = stream;
      setStatus('live');
    } catch (error) {
      setErrorKind(toCameraError(error).kind);
      setStatus('error');
    }
  }, [camera, replaceImage]);

  // Attach the stream once the <video> element is rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (status === 'live' && video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      void Promise.resolve(video.play()).catch(() => undefined);
    }
  }, [status]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const captured = await camera.capture(video);
      replaceImage(captured);
      stopStream();
      setStatus('captured');
    } catch (error) {
      setErrorKind(error instanceof CameraError ? error.kind : 'unknown');
      setStatus('error');
    }
  }, [camera, replaceImage, stopStream]);

  const stop = useCallback(() => {
    stopStream();
    setStatus(image ? 'captured' : 'idle');
  }, [image, stopStream]);

  const setUploadedImage = useCallback(
    (next: CapturedImage) => {
      stopStream();
      replaceImage(next);
      setErrorKind(null);
      setStatus('captured');
    },
    [replaceImage, stopStream],
  );

  const discard = useCallback(() => {
    stopStream();
    replaceImage(null);
    setStatus('idle');
  }, [replaceImage, stopStream]);

  const imageRef = useRef(image);
  imageRef.current = image;
  useEffect(
    () => () => {
      camera.stop(streamRef.current);
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
    },
    [camera],
  );

  return { videoRef, status, errorKind, image, start, capture, retake: start, stop, setUploadedImage, discard };
}
