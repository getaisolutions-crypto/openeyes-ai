import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, createFakeCamera, createFakeVoice, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import { toCameraError } from '../services/camera/browserCameraProvider';
import { AIRequestError } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import type { ListeningHandlers } from '../types/voice';
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

function setup(post: Post, { consent = true, cameraStart }: { consent?: boolean; cameraStart?: () => Promise<MediaStream> } = {}) {
  if (consent) window.localStorage.setItem(STORAGE_KEYS.liveExploreConsent, 'true');
  const backend: OpenEyesBackend = {
    post: vi.fn(post),
    health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
  };
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const camera = createFakeCamera({
    capture: vi.fn(async () => frame()),
    start: vi.fn(cameraStart ?? (async () => stream)),
  });
  let listening: ListeningHandlers | null = null;
  const voice = createFakeVoice({
    isSynthesisSupported: () => true,
    isRecognitionSupported: () => true,
    speak: vi.fn((_text: string, options: { onEnd?: () => void }) => options.onEnd?.()),
    startListening: vi.fn((handlers: ListeningHandlers) => {
      listening = handlers;
      return { stop: vi.fn(), abort: vi.fn() };
    }),
  });
  const providers = createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA');
  const services = createTestServices({ ...providers, camera, voice });
  return { services, backend, camera, voice, stream, hear: (text: string) => act(() => listening?.onFinal(text)) };
}

const live = () => within(screen.getByRole('region', { name: 'Live Explore' }));
const spoken = (voice: ReturnType<typeof setup>['voice']) => vi.mocked(voice.speak).mock.calls.map((c) => c[0]);

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
}

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(live().getByLabelText('Type a question or command'), text);
  await user.click(live().getByRole('button', { name: 'Send question or command' }));
}

describe('Live Explore', () => {
  it('is unavailable without the Meta AI connection and never starts the camera', async () => {
    const camera = createFakeCamera();
    renderApp('/explore', createTestServices({ camera }));
    expect(await screen.findByRole('button', { name: 'Start exploring' })).toBeDisabled();
    expect(screen.getByText('Live Explore not available yet')).toBeInTheDocument();
    expect(camera.start).not.toHaveBeenCalled();
  });

  it('explains camera and data use before the first start, and does nothing if cancelled', async () => {
    const user = userEvent.setup();
    const { services, camera } = setup(async () => ({ text: 'unused' }), { consent: false });
    renderApp('/explore', services);
    await start(user);
    const dialog = await screen.findByRole('alertdialog', { name: 'Before Live Explore starts' });
    expect(within(dialog).getByText(/Frames are not saved/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(camera.start).not.toHaveBeenCalled();
  });

  it('turns on the camera after confirmation, shows a text indicator and says so', async () => {
    const user = userEvent.setup();
    const { services, camera, voice, backend } = setup(async () => ({ text: 'unused' }), { consent: false });
    renderApp('/explore', services);
    await start(user);
    await user.click(await screen.findByRole('button', { name: 'I understand, turn on camera' }));
    expect(camera.start).toHaveBeenCalledTimes(1);
    expect(await live().findByText('Camera on, waiting for your question')).toBeInTheDocument();
    expect(spoken(voice).some((t) => t.startsWith('Camera on. Live Explore started'))).toBe(true);
    expect(screen.getByText('Single photo is paused')).toBeInTheDocument();
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('reports camera permission denial in text and speech', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ text: 'unused' }), {
      cameraStart: async () => {
        throw toCameraError(new DOMException('denied', 'NotAllowedError'));
      },
    });
    renderApp('/explore', services);
    await start(user);
    expect(await live().findByText('Live Explore could not use the camera')).toBeInTheDocument();
    expect(spoken(voice)).toContain('Camera permission was denied. Live Explore cannot start.');
  });

  it('answers a question about the current view with a fresh frame and labels the source', async () => {
    const user = userEvent.setup();
    const { services, backend, voice, camera } = setup(async () => ({ task: 'chat', text: 'On the left side of the camera view there is a chair.' }));
    renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    await type(user, "What's on my left?");
    expect(await live().findByText('On the left side of the camera view there is a chair.')).toBeInTheDocument();
    expect(live().getByText('Based on: Current camera view')).toBeInTheDocument();
    expect(camera.capture).toHaveBeenCalledTimes(1);
    const body = vi.mocked(backend.post).mock.calls[0][0] as Record<string, unknown>;
    expect(body.task).toBe('chat');
    expect(body.image).toBeDefined();
    expect(spoken(voice)).toContain('On the left side of the camera view there is a chair.');
  });

  it('answers a past-tense question from the earlier frame without taking a new one', async () => {
    const user = userEvent.setup();
    const { services, backend, camera } = setup(async (body) =>
      body.task === 'describe' ? { task: 'describe', text: 'A table with a blue cup.' } : { task: 'chat', text: 'The cup looked blue.' },
    );
    renderApp('/explore', services);
    await start(user);
    await user.click(await live().findByRole('button', { name: 'Describe now' }));
    expect(await live().findByText('A table with a blue cup.')).toBeInTheDocument();
    await type(user, 'What color was the cup?');
    expect(await live().findByText('The cup looked blue.')).toBeInTheDocument();
    expect(camera.capture).toHaveBeenCalledTimes(1);
    expect(live().getByText(/Based on: Earlier camera view from/)).toBeInTheDocument();
    const chat = vi.mocked(backend.post).mock.calls[1][0] as { messages: { content: string }[] };
    expect(chat.messages[0].content).toContain('What color was the cup?');
  });

  it('the microphone stops speech before listening, and routes "Find my keys"', async () => {
    const user = userEvent.setup();
    const { services, backend, voice, hear } = setup(async () => ({
      task: 'find',
      find: { visibility: 'visible', position: 'Near the bottom of the camera view, on the table.', confidence: 'medium', suggestion: '' },
    }));
    renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    vi.mocked(voice.stopSpeaking).mockClear();
    await user.click(live().getByRole('button', { name: 'Talk to OpenEyes. Stops speech and listens' }));
    expect(voice.stopSpeaking).toHaveBeenCalled();
    expect(vi.mocked(voice.stopSpeaking).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(voice.startListening).mock.invocationCallOrder[0],
    );
    await hear('Find my keys');
    await waitFor(() => expect(backend.post).toHaveBeenCalledWith(expect.objectContaining({ task: 'find', objectName: 'keys' }), expect.anything()));
    expect(await live().findByText(/keys appears to be in the photo/)).toBeInTheDocument();
  });

  it('pauses, resumes and stops by voice, and turns the camera off on stop', async () => {
    const user = userEvent.setup();
    const { services, camera, stream, hear } = setup(async () => ({ text: 'unused' }));
    renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    await user.click(live().getByRole('button', { name: 'Talk to OpenEyes. Stops speech and listens' }));
    await hear('Pause');
    expect(await live().findByText('Camera on, paused. Nothing is being sent.')).toBeInTheDocument();
    await hear('Keep exploring');
    expect(await live().findByText('Camera on, waiting for your question')).toBeInTheDocument();
    await hear('Stop');
    expect(await live().findByText('Exploring stopped. Camera off.')).toBeInTheDocument();
    expect(camera.stop).toHaveBeenCalledWith(stream);
    expect(live().getByRole('button', { name: 'Start exploring' })).toBeEnabled();
  });

  it('describes the first frame automatically in Smart Explore and stays quiet about repeats', async () => {
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ exploreMode: 'smart' }));
    const user = userEvent.setup();
    const { services, backend, voice } = setup(async () => ({ task: 'describe', text: 'A hallway with a door at the end.' }));
    renderApp('/explore', services);
    await start(user);
    expect(await live().findByText('A hallway with a door at the end.')).toBeInTheDocument();
    expect(backend.post).toHaveBeenCalledWith(expect.objectContaining({ task: 'describe' }), expect.anything());
    expect(spoken(voice)).toContain('A hallway with a door at the end.');
  });

  it('shows a clear error when the network fails, without inventing an answer', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => {
      throw new AIRequestError('network', 'Could not reach the OpenEyes server. Check your internet connection.');
    });
    renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    await type(user, "What's in front of me?");
    expect(await live().findByText('Could not reach the OpenEyes server. Check your internet connection.')).toBeInTheDocument();
    expect(live().queryByText(/Based on:/)).not.toBeInTheDocument();
  });

  it('tells the user when Meta AI is rate limited', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => {
      throw new AIRequestError('rate-limited', 'OpenEyes is getting too many requests. Please wait a minute and try again.', 60);
    });
    renderApp('/explore', services);
    await start(user);
    await user.click(await live().findByRole('button', { name: 'Describe now' }));
    expect(await live().findByText(/too many requests.*Live Explore will wait/)).toBeInTheDocument();
  });

  it('stops and releases the camera when the app goes to the background', async () => {
    const user = userEvent.setup();
    const { services, camera, stream } = setup(async () => ({ text: 'unused' }));
    renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    expect(await live().findByText(/Exploring stopped because OpenEyes left the screen/)).toBeInTheDocument();
    expect(camera.stop).toHaveBeenCalledWith(stream);
  });

  it('releases the camera when leaving the Explore screen', async () => {
    const user = userEvent.setup();
    const { services, camera, stream } = setup(async () => ({ text: 'unused' }));
    const { unmount } = renderApp('/explore', services);
    await start(user);
    await live().findByText('Camera on, waiting for your question');
    unmount();
    expect(camera.stop).toHaveBeenCalledWith(stream);
  });

  it('asks before saving an observation as a memory', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => ({ task: 'describe', text: 'A red umbrella by the door.' }));
    renderApp('/explore', services);
    await start(user);
    await user.click(await live().findByRole('button', { name: 'Describe now' }));
    await live().findByText('A red umbrella by the door.');
    await type(user, 'Remember this');
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    await waitFor(async () => expect((await services.memory.list()).map((m) => m.text).join()).toContain('A red umbrella by the door.'));
  });

  it('has no detectable accessibility violations', async () => {
    const { services } = setup(async () => ({ text: 'unused' }));
    const { container } = renderApp('/explore', services);
    await screen.findByRole('button', { name: 'Start exploring' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
