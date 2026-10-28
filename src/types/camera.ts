export type CameraSourceId = 'phone' | 'meta-glasses';

export type CameraErrorKind =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'unknown';

export class CameraError extends Error {
  readonly kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

export interface CapturedImage {
  blob: Blob;
  /** Object URL for local preview only. Must be revoked when discarded. */
  previewUrl: string;
  width: number;
  height: number;
  capturedAt: string;
  source: CameraSourceId | 'upload';
}

export interface CameraStartOptions {
  facingMode?: 'environment' | 'user';
}

export interface CameraProvider {
  readonly source: CameraSourceId;
  isSupported(): boolean;
  start(options?: CameraStartOptions): Promise<MediaStream>;
  stop(stream: MediaStream | null): void;
  capture(video: HTMLVideoElement): Promise<CapturedImage>;
}
