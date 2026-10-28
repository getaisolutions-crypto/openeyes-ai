import type { CapturedImage } from './camera';

/** Meta model families OpenEyes uses or plans to use. The exact API model version is reported separately. */
export type MetaModelId = 'muse-spark' | 'muse-spark-open' | 'sam-3.1' | 'muse-voice-transcribe';

export type AICapability =
  | 'conversation'
  | 'scene-description'
  | 'text-reading'
  | 'object-finding'
  | 'speech-to-text';

export type ResponseLength = 'brief' | 'standard' | 'detailed';

export interface ProviderStatus {
  available: boolean;
  /** Human-readable reason shown to the user when unavailable. */
  reason?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** How the user produced the message. */
  inputMode?: 'voice' | 'text';
  /** True when a camera photo was sent with this question. */
  photoAttached?: boolean;
  /** Number of saved memories shared as background for this answer. */
  memoriesShared?: number;
}

export interface ChatRequest {
  messages: ChatMessage[];
  responseLength: ResponseLength;
  /** Current camera evidence for the latest question, if the user attached a photo. */
  image?: CapturedImage;
  /** User-approved saved memories relevant to the latest question. */
  memories?: string[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  message: ChatMessage;
  modelId: MetaModelId;
  /** Exact model version reported by the API, e.g. muse-spark-1.3. */
  modelVersion?: string;
}

export interface ConnectionCheck {
  /** True when the OpenEyes server is reachable and has a Meta API key. */
  configured: boolean;
  message: string;
  modelVersion?: string;
}

/** Conversational assistant (Muse Spark through the OpenEyes server). */
export interface AIProvider {
  readonly id: string;
  getStatus(): ProviderStatus;
  sendMessage(request: ChatRequest): Promise<ChatResponse>;
  checkConnection(signal?: AbortSignal): Promise<ConnectionCheck>;
}

export interface SceneDescription {
  summary: string;
  modelId: MetaModelId;
  modelVersion?: string;
}

export interface TextReadingResult {
  /** Exactly the text the model read. Empty when nothing was readable. */
  text: string;
  readable: boolean;
  modelId: MetaModelId;
  modelVersion?: string;
}

/** Image understanding (Muse Spark multimodal through the OpenEyes server). */
export interface VisionProvider {
  readonly id: string;
  getStatus(): ProviderStatus;
  describeScene(image: CapturedImage, options: { responseLength: ResponseLength; signal?: AbortSignal }): Promise<SceneDescription>;
  readText(image: CapturedImage, options?: { signal?: AbortSignal }): Promise<TextReadingResult>;
}

export interface NormalizedBox {
  /** 0..1 relative to image width/height. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedObject {
  label: string;
  confidence: number;
  box: NormalizedBox;
  /** Optional segmentation mask as a data URL, if the model returns one. */
  maskUrl?: string;
}

export type ObjectVisibility = 'visible' | 'not-visible' | 'uncertain';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ObjectDetectionResult {
  query: string;
  visibility: ObjectVisibility;
  /** Where the item is relative to other things in the photo. Empty when not visible. */
  positionDescription: string;
  confidence: ConfidenceLevel;
  suggestion: string;
  /** Boxes/masks. Empty for Muse Spark; filled when SAM 3.1 segmentation is added. */
  matches: DetectedObject[];
  modelId: MetaModelId;
  modelVersion?: string;
}

/** Object finding (Muse Spark visual reasoning today; SAM 3.1 segmentation can implement this later). */
export interface ObjectDetectionProvider {
  readonly id: string;
  getStatus(): ProviderStatus;
  findObject(query: string, image: CapturedImage, options?: { signal?: AbortSignal }): Promise<ObjectDetectionResult>;
}

export type AIErrorKind =
  | 'not-configured'
  | 'auth'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'unsupported-image'
  | 'image-too-large'
  | 'rejected'
  | 'bad-response'
  | 'server'
  | 'cancelled';

export class AIRequestError extends Error {
  readonly kind: AIErrorKind;
  readonly retryAfterSeconds?: number;
  constructor(kind: AIErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AIRequestError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderUnavailableError extends Error {
  readonly capability: AICapability;
  constructor(capability: AICapability, message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.capability = capability;
  }
}
