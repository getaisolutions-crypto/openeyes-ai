import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, createFakeCamera, createFakeVoice, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import type { CapturedImage } from '../types/camera';
import type { ListeningHandlers, VoiceProvider } from '../types/voice';
import { STORAGE_KEYS } from '../utils/storage';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

let n = 0;
const frame = (): CapturedImage => ({
  blob: new Blob([`frame-${++n}`], { type: 'image/jpeg' }),
  previewUrl: `blob:frame-${n}`,
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone',
});

type Post = OpenEyesBackend['post'];

function setup(post: Post, { consent = true, voiceOverrides = {} }: { consent?: boolean; voiceOverrides?: Partial<VoiceProvider> } = {}) {
  window.localStorage.setItem(STORAGE_KEYS.liveExploreConsent, 'true');
  if (consent) window.localStorage.setItem(STORAGE_KEYS.voiceConversationConsent, 'true');
  const backend: OpenEyesBackend = {
    post: vi.fn(post),
    health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
  };
  const camera = createFakeCamera({
    capture: vi.fn(async () => frame()),
    start: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
  });
  const sessions: { handlers: ListeningHandlers; abort: ReturnType<typeof vi.fn> }[] = [];
  const voice = createFakeVoice({
    isSynthesisSupported: () => true,
    isRecognitionSupported: () => true,
    speak: vi.fn((_text: string, options: { onStart?: () => void; onEnd?: () => void }) => {
      options.onStart?.();
      options.onEnd?.();
    }),
    startListening: vi.fn((handlers: ListeningHandlers) => {
      const abort = vi.fn();
      sessions.push({ handlers, abort });
      return { stop: vi.fn(), abort };
    }),
    ...voiceOverrides,
  });
  const providers = createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA');
  const services = createTestServices({ ...providers, camera, voice });
  const hear = async (text: string) => {
    await waitFor(() => expect(sessions.length).toBeGreaterThan(0));
    const count = sessions.length;
    act(() => sessions[count - 1].handlers.onFinal(text));
  };
  return { services, backend, camera, voice, sessions, hear };
}

const live = () => within(screen.getByRole('region', { name: 'Live Explore' }));
const spoken = (voice: VoiceProvider) => vi.mocked(voice.speak).mock.calls.map((c) => c[0]);
const startButton = () => screen.findByRole('button', { name: 'Start Voice Conversation' });

async function startConversation(user: ReturnType<typeof userEvent.setup>, voice: VoiceProvider) {
  await user.click(await startButton());
  await waitFor(() => expect(voice.startListening).toHaveBeenCalled());
  await screen.findByText('Listening. Microphone on');
}

describe('Voice conversation', () => {
  it('explains microphone use before the first start and does nothing if cancelled', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ text: 'unused' }), { consent: false });
    renderApp('/explore', services);
    await user.click(await startButton());
    const dialog = await screen.findByRole('alertdialog', { name: 'Before the voice conversation starts' });
    expect(within(dialog).getByText(/never records or saves audio/)).toBeInTheDocument();
    expect(within(dialog).getByText(/never listens in the background/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(voice.requestMicrophone).not.toHaveBeenCalled();
    expect(voice.startListening).not.toHaveBeenCalled();
  });

  it('starts after confirmation, answers without the camera and listens again by itself', async () => {
    const user = userEvent.setup();
    const { services, voice, backend, sessions, hear, camera } = setup(async () => ({ text: 'Try large print labels.' }), { consent: false });
    renderApp('/explore', services);
    await user.click(await startButton());
    await user.click(await screen.findByRole('button', { name: 'I understand, turn on microphone' }));
    await waitFor(() => expect(voice.startListening).toHaveBeenCalledTimes(1));
    expect(voice.requestMicrophone).toHaveBeenCalledTimes(1);
    expect(spoken(voice)[0]).toMatch(/Voice conversation started. Microphone on.*camera is off/);

    await hear('How can I label my spices?');
    await waitFor(() => expect(spoken(voice)).toContain('Try large print labels.'));
    const body = vi.mocked(backend.post).mock.calls[0][0] as { task: string; image?: unknown; messages: { content: string }[] };
    expect(body.task).toBe('chat');
    expect(body.image).toBeUndefined();
    expect(body.messages[body.messages.length - 1].content).toMatch(/camera is off/i);
    expect(camera.start).not.toHaveBeenCalled();
    expect(live().getByText(/Conversation only, camera off/)).toBeInTheDocument();

    await waitFor(() => expect(sessions.length).toBe(2));
    expect(sessions[0].abort).toHaveBeenCalled();
  });

  it('keeps short-term context for follow-up questions about the camera view', async () => {
    const user = userEvent.setup();
    const replies = ['A table with a bottle on it.', 'The bottle is green.'];
    const { services, voice, backend, hear } = setup(async () => ({ text: replies.shift() ?? 'unused' }));
    renderApp('/explore', services);
    await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
    await screen.findByRole('button', { name: 'Stop exploring' });
    await startConversation(user, voice);

    await hear("What's in front of me?");
    await waitFor(() => expect(spoken(voice)).toContain('A table with a bottle on it.'));
    await waitFor(() => expect(vi.mocked(voice.startListening).mock.calls.length).toBeGreaterThan(1));
    await hear('What color is the bottle?');
    await waitFor(() => expect(spoken(voice)).toContain('The bottle is green.'));

    const second = vi.mocked(backend.post).mock.calls[1][0] as { image?: unknown; messages: { role: string; content: string }[] };
    expect(second.image).toBeDefined();
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[2].content).toMatch(/Only the attached photo shows what is in view now/);
  });

  it('stops by voice command or button and turns the microphone off', async () => {
    const user = userEvent.setup();
    const { services, voice, sessions, hear } = setup(async () => ({ text: 'unused' }));
    renderApp('/explore', services);
    await startConversation(user, voice);
    await hear('stop conversation');
    await waitFor(() => expect(spoken(voice)).toContain('Voice conversation ended. Microphone off.'));
    expect(await startButton()).toBeInTheDocument();
    const count = sessions.length;
    await new Promise((r) => setTimeout(r, 600));
    expect(sessions.length).toBe(count);

    await startConversation(user, voice);
    await user.click(screen.getByRole('button', { name: 'Stop conversation' }));
    expect(sessions[sessions.length - 1].abort).toHaveBeenCalled();
    expect(await startButton()).toBeInTheDocument();
  });

  it('ends when the page is hidden', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ text: 'unused' }));
    renderApp('/explore', services);
    await startConversation(user, voice);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await waitFor(() => expect(spoken(voice)).toContain('Voice conversation ended because OpenEyes left the screen. Microphone off.'));
  });

  it('explains a denied microphone and keeps typing available', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ text: 'unused' }), {
      voiceOverrides: {
        requestMicrophone: vi.fn(async () => {
          throw 'permission-denied';
        }),
      },
    });
    renderApp('/explore', services);
    await user.click(await startButton());
    await waitFor(() => expect(spoken(voice).join(' ')).toMatch(/Microphone permission was denied/));
    expect(voice.startListening).not.toHaveBeenCalled();
    expect(live().getByLabelText('Type a question or command')).toBeInTheDocument();
  });

  it('shows a fallback when speech recognition is not supported', async () => {
    const { services } = setup(async () => ({ text: 'unused' }), { voiceOverrides: { isRecognitionSupported: () => false } });
    renderApp('/explore', services);
    expect(await startButton()).toBeDisabled();
    expect(screen.getByText('Voice conversation not available')).toBeInTheDocument();
  });

  it('the Talk button interrupts and typed questions go through the conversation', async () => {
    const user = userEvent.setup();
    const { services, voice, backend } = setup(async () => ({ text: 'Typed answer.' }));
    renderApp('/explore', services);
    await startConversation(user, voice);
    expect(screen.getByRole('button', { name: 'Listening now. Microphone on' })).toBeDisabled();
    await user.type(live().getByLabelText('Type a question or command'), 'Tell me a tip');
    await user.click(live().getByRole('button', { name: 'Send question or command' }));
    await waitFor(() => expect(spoken(voice)).toContain('Typed answer.'));
    expect(backend.post).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations during a conversation', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ text: 'unused' }));
    const { container } = renderApp('/explore', services);
    await startConversation(user, voice);
    expect(await axeViolations(container)).toEqual([]);
  });
});
