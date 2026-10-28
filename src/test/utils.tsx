import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { vi } from 'vitest';
import { App } from '../App';
import { createDefaultServices, createUnavailableAIServices, type Services } from '../services/ServicesContext';
import type { CameraProvider } from '../types/camera';
import type { VoiceProvider } from '../types/voice';

export function createFakeVoice(overrides: Partial<VoiceProvider> = {}): VoiceProvider {
  return {
    id: 'fake-voice',
    isRecognitionSupported: () => false,
    isSynthesisSupported: () => false,
    requestMicrophone: vi.fn(async () => undefined),
    startListening: vi.fn(() => ({ stop: vi.fn(), abort: vi.fn() })),
    speak: vi.fn(),
    getVoices: () => [],
    pause: vi.fn(),
    resume: vi.fn(),
    stopSpeaking: vi.fn(),
    ...overrides,
  };
}

export function createFakeCamera(overrides: Partial<CameraProvider> = {}): CameraProvider {
  return {
    source: 'phone',
    isSupported: () => true,
    start: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
    stop: vi.fn(),
    capture: vi.fn(),
    ...overrides,
  };
}

/** AI providers default to "unavailable" so no test ever reaches the real server. Override them to inject fakes. */
export function createTestServices(overrides: Partial<Services> = {}): Services {
  return {
    ...createDefaultServices(),
    ...createUnavailableAIServices(),
    voice: createFakeVoice(),
    camera: createFakeCamera(),
    ...overrides,
  };
}

export function renderApp(route = '/', services: Services = createTestServices()) {
  return {
    services,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <App services={services} />
      </MemoryRouter>,
    ),
  };
}

/** Runs axe-core; color-contrast is skipped because jsdom does not compute styles. */
export async function axeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}
