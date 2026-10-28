import { createContext, useContext, type ReactNode } from 'react';
import type { AIProvider, ObjectDetectionProvider, VisionProvider } from '../types/ai';
import type { CameraProvider } from '../types/camera';
import type { DeviceProvider } from '../types/devices';
import type { ContactsProvider, MemoryProvider } from '../types/memory';
import type { VoiceProvider } from '../types/voice';
import {
  createUnavailableAIProvider,
  createUnavailableObjectDetectionProvider,
  createUnavailableVisionProvider,
} from './ai/unavailableProviders';
import { createMetaProviders } from './ai/metaProviders';
import { createOpenEyesBackend, getBackendConfigFromEnv } from './ai/openEyesBackend';
import { createBrowserCameraProvider } from './camera/browserCameraProvider';
import { createMetaGlassesDevice } from './devices/metaGlassesDevice';
import { createPhoneCameraDevice, createPhoneMicrophoneDevice } from './devices/phoneDevices';
import { createLocalContactsProvider } from './memory/localContactsProvider';
import { createLocalMemoryProvider } from './memory/localMemoryProvider';
import { createWebSpeechVoiceProvider } from './voice/webSpeechVoiceProvider';

export interface Services {
  ai: AIProvider;
  vision: VisionProvider;
  objectDetection: ObjectDetectionProvider;
  voice: VoiceProvider;
  camera: CameraProvider;
  memory: MemoryProvider;
  contacts: ContactsProvider;
  devices: {
    phoneCamera: DeviceProvider;
    phoneMicrophone: DeviceProvider;
    metaGlasses: DeviceProvider;
  };
}

export function createUnavailableAIServices(): Pick<Services, 'ai' | 'vision' | 'objectDetection'> {
  return {
    ai: createUnavailableAIProvider(),
    vision: createUnavailableVisionProvider(),
    objectDetection: createUnavailableObjectDetectionProvider(),
  };
}

function createAIServices(): Pick<Services, 'ai' | 'vision' | 'objectDetection'> {
  const config = getBackendConfigFromEnv();
  return config ? createMetaProviders(createOpenEyesBackend(config)) : createUnavailableAIServices();
}

export function createDefaultServices(): Services {
  return {
    ...createAIServices(),
    voice: createWebSpeechVoiceProvider(),
    camera: createBrowserCameraProvider(),
    memory: createLocalMemoryProvider(),
    contacts: createLocalContactsProvider(),
    devices: {
      phoneCamera: createPhoneCameraDevice(),
      phoneMicrophone: createPhoneMicrophoneDevice(),
      metaGlasses: createMetaGlassesDevice(),
    },
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside ServicesProvider');
  return services;
}
