/**
 * Contract for a natural (neural) text-to-speech service. No provider is connected yet: until one is configured
 * on the OpenEyes server, the browser's built-in voices are used. Implementations must call their service
 * through the server so API keys never reach the browser.
 */

export interface NeuralVoice {
  id: string;
  name: string;
  lang: string;
}

export interface NeuralSpeechConfig {
  voiceId?: string;
  /** 1 is normal speed; providers map it to their own range. */
  rate: number;
  lang?: string;
}

export type NeuralTTSErrorKind = 'not-configured' | 'network' | 'rate-limited' | 'rejected' | 'playback' | 'cancelled' | 'server';

export class NeuralTTSError extends Error {
  constructor(
    readonly kind: NeuralTTSErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'NeuralTTSError';
  }
}

export interface NeuralTTSProvider {
  readonly id: string;
  /** Name shown to the user, e.g. the service and voice family. */
  readonly label: string;
  /** True once the server reports working credentials. */
  isConfigured(): boolean;
  readonly supportsStreaming: boolean;
  listVoices(signal?: AbortSignal): Promise<NeuralVoice[]>;
  /** Returns playable audio (for example MP3 or WAV). Rejects with NeuralTTSError. */
  synthesize(text: string, config: NeuralSpeechConfig, signal: AbortSignal): Promise<Blob>;
  /** Optional: audio chunks as they are generated, for a faster start. */
  synthesizeStream?(text: string, config: NeuralSpeechConfig, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
