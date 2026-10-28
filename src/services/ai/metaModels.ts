import type { AICapability, MetaModelId } from '../../types/ai';

export interface PlannedModel {
  id: MetaModelId;
  name: string;
  /** What OpenEyes intends to use the model for. Exact inputs, outputs and limits must be confirmed from official Meta documentation. */
  plannedUse: string;
  capabilities: AICapability[];
  status: 'planned';
}

export const PLANNED_META_MODELS: PlannedModel[] = [
  {
    id: 'muse-spark',
    name: 'Muse Spark',
    plannedUse: 'Conversation, scene descriptions and reading text from captured images.',
    capabilities: ['conversation', 'scene-description', 'text-reading'],
    status: 'planned',
  },
  {
    id: 'muse-spark-open',
    name: 'Muse Spark Open',
    plannedUse: 'Open-weight alternative for conversation, evaluated for self-hosting and privacy.',
    capabilities: ['conversation'],
    status: 'planned',
  },
  {
    id: 'sam-3.1',
    name: 'SAM 3.1',
    plannedUse: 'Locating and outlining a named object in a captured image for the Find feature.',
    capabilities: ['object-finding'],
    status: 'planned',
  },
  {
    id: 'muse-voice-transcribe',
    name: 'Muse Voice Transcribe',
    plannedUse: 'Speech-to-text for voice input, replacing the browser speech service.',
    capabilities: ['speech-to-text'],
    status: 'planned',
  },
];
