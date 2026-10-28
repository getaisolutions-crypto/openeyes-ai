import type { CapturedImage } from './camera';

/** Meta models OpenEyes plans to use. Inputs/outputs must be verified against official Meta docs in Phase 2. */
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
}

export interface ChatRequest {
  messages: ChatMessage[];
  responseLength: ResponseLength;
  signal?: AbortSignal;
}

export interface ChatResponse {
  message: ChatMessage;
  modelId: MetaModelId;
}

/** Conversational assistant (planned: Muse Spark via a secure backend). */
export interface AIProvider {
  readonly id: string;
  getStatus(): ProviderStatus;
  sendMessage(request: ChatRequest): Promise<ChatResponse>;
}

export interface SceneDescription {
  summary: string;
  modelId: MetaModelId;
}

export interface TextReadingResult {
  text: string;
  modelId: MetaModelId;
}

/** Image understanding (planned: Muse Spark multimodal via a secure backend). */
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

export interface ObjectDetectionResult {
  query: string;
  matches: DetectedObject[];
  modelId: MetaModelId;
}

/** Object finding and segmentation (planned: SAM 3.1 via a secure backend). */
export interface ObjectDetectionProvider {
  readonly id: string;
  getStatus(): ProviderStatus;
  findObject(query: string, image: CapturedImage, options?: { signal?: AbortSignal }): Promise<ObjectDetectionResult>;
}

export class ProviderUnavailableError extends Error {
  readonly capability: AICapability;
  constructor(capability: AICapability, message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.capability = capability;
  }
}
