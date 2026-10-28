import type { AICapability, MetaModelId } from '../../types/ai';

export interface MetaModelInfo {
  id: MetaModelId;
  name: string;
  /** What OpenEyes uses, or intends to use, the model for. */
  use: string;
  capabilities: AICapability[];
  /** 'integrated' means OpenEyes has working code for it; it still needs the server API key to answer. */
  status: 'integrated' | 'planned';
}

export const META_MODELS: MetaModelInfo[] = [
  {
    id: 'muse-spark',
    name: 'Muse Spark',
    use: 'Conversation, scene descriptions, finding objects and reading text from photos you choose to send.',
    capabilities: ['conversation', 'scene-description', 'object-finding', 'text-reading'],
    status: 'integrated',
  },
  {
    id: 'muse-spark-open',
    name: 'Muse Spark Open',
    use: 'Open-weight alternative for conversation, evaluated for self-hosting and privacy.',
    capabilities: ['conversation'],
    status: 'planned',
  },
  {
    id: 'sam-3.1',
    name: 'SAM 3.1',
    use: 'Outlining the exact area of a named object in a photo for the Find feature.',
    capabilities: ['object-finding'],
    status: 'planned',
  },
  {
    id: 'muse-voice-transcribe',
    name: 'Muse Voice Transcribe',
    use: 'Speech-to-text for voice input, replacing the browser speech service.',
    capabilities: ['speech-to-text'],
    status: 'planned',
  },
];
