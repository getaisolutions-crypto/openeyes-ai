import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createFakeVoice, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import { routeIntent } from '../services/assistant/intentRouter';
import { SCAN_INTERVAL_MS } from '../services/find/objectSearch';
import { AIRequestError } from '../types/ai';
import type { ListeningHandlers } from '../types/voice';
import { STORAGE_KEYS } from '../utils/storage';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

const frame = () => ({
  blob: new Blob(['f'], { type: 'image/jpeg' }),
  previewUrl: 'blob:f',
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone' as const,
});

function setup(post: OpenEyesBackend['post']) {
  window.localStorage.setItem(STORAGE_KEYS.liveExploreConsent, 'true');
  window.localStorage.setItem(STORAGE_KEYS.voiceConversationConsent, 'true');
  const backend: OpenEyesBackend = {
    post: vi.fn(post),
    health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
  };
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const camera = createFakeCamera({ capture: vi.fn(async () => frame()), start: vi.fn(async () => stream) });
  const sessions: { handlers: ListeningHandlers; abort: ReturnType<typeof vi.fn> }[] = [];
  const voice = createFakeVoice({
    isSynthesisSupported: () => true,
    isRecognitionSupported: () => true,
    speak: vi.fn((_t: string, o: { onStart?: () => void; onEnd?: () => void }) => {
      o.onStart?.();
      o.onEnd?.();
    }),
    startListening: vi.fn((handlers: ListeningHandlers) => {
      const abort = vi.fn();
      sessions.push({ handlers, abort });
      return { stop: vi.fn(), abort };
    }),
  });
  const services = createTestServices({ ...createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'), camera, voice });
  return { services, backend, camera, voice, stream, sessions };
}

const spoken = (voice: ReturnType<typeof setup>['voice']) => vi.mocked(voice.speak).mock.calls.map((c) => c[0]);

async function sendToAssistant(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText('Type a message'), text);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('Voice intent routing', () => {
  const ctx = { taskActive: false, hasPhoto: false };

  it.each([
    ['OpenEyes, find my keys.', 'find'],
    ['Can you see my wallet?', 'find'],
    ['Help me find my water bottle', 'find'],
    ['Where did I leave my glasses?', 'where-is'],
    ['Read this letter', 'read'],
    ["What's the expiration date?", 'read'],
    ["What's around me?", 'explore'],
    ['Remember that my glasses are in the bedroom drawer', 'remember'],
    ['Remind me to call John tomorrow', 'reminder'],
    ['Help me make coffee', 'task'],
    ['What is the capital of France?', 'chat'],
  ])('routes "%s" to %s', (text, kind) => {
    expect(routeIntent(text, ctx).kind).toBe(kind);
  });

  it('treats "next" as a task command only while a task is running', () => {
    expect(routeIntent('Next step', { ...ctx, taskActive: true })).toEqual({ kind: 'task-command', command: 'next' });
    expect(routeIntent('Next step', ctx).kind).toBe('chat');
  });

  it('keeps questions about an attached photo in the conversation', () => {
    expect(routeIntent('Read this letter', { ...ctx, hasPhoto: true }).kind).toBe('chat');
  });
});

describe('Cross-feature conversations', () => {
  it('opens Find from the Assistant with the item already filled in, without calling Meta AI', async () => {
    const user = userEvent.setup();
    const { services, backend } = setup(async () => ({ text: 'unused' }));
    renderApp('/assistant', services);
    await sendToAssistant(user, 'Find my keys');
    expect(await screen.findByRole('heading', { level: 1, name: /Find/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('keys')).toBeInTheDocument();
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('opens Read from the Assistant', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => ({ text: 'unused' }));
    renderApp('/assistant', services);
    await sendToAssistant(user, 'Read this letter');
    expect(await screen.findByRole('heading', { level: 1, name: /Read/ })).toBeInTheDocument();
  });

  it('answers a remembered location from memory and points to the camera to check', async () => {
    const user = userEvent.setup();
    const { services, backend } = setup(async () => ({ text: 'unused' }));
    await services.memory.create({ text: 'My glasses are in the bedroom drawer.', category: 'object-location', subject: 'glasses' });
    renderApp('/assistant', services);
    await sendToAssistant(user, 'Where did I leave my glasses?');
    const list = within(await screen.findByRole('list', { name: 'Messages' }));
    expect(await list.findByText(/bedroom drawer.*find my glasses/)).toBeInTheDocument();
    expect(list.getByText(/from your saved memories, not the camera/)).toBeInTheDocument();
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('in Live Explore, describes the view, then saves a location only after confirmation', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ task: 'describe', text: 'A table with a book, a cup and a set of keys.' }));
    renderApp('/explore', services);
    await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
    const live = within(screen.getByRole('region', { name: 'Live Explore' }));
    await user.click(await live.findByRole('button', { name: 'Describe now' }));
    expect(await live.findByText('A table with a book, a cup and a set of keys.')).toBeInTheDocument();

    const ask = async (text: string) => {
      await user.type(live.getByLabelText('Type a question or command'), text);
      await user.click(live.getByRole('button', { name: 'Send question or command' }));
    };
    await ask('Remember that my keys are on this table');
    await waitFor(() => expect(spoken(voice)).toContain('Would you like me to remember that location?'));
    expect(await services.memory.list()).toHaveLength(0);
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save this memory?' })).getByRole('button', { name: 'Save memory' }));
    await waitFor(() => expect(spoken(voice)).toContain('Saved.'));
    const saved = await services.memory.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ category: 'object-location', subject: 'keys', text: 'My keys are on this table.' });
  });

  it('in Live Explore, accepts "yes" and "no" as answers to the save question', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup(async () => ({ task: 'describe', text: 'A shelf.' }));
    renderApp('/explore', services);
    await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
    const live = within(screen.getByRole('region', { name: 'Live Explore' }));
    await live.findByText('Camera on, waiting for your question');
    const ask = async (text: string) => {
      await user.type(live.getByLabelText('Type a question or command'), text);
      await user.click(live.getByRole('button', { name: 'Send question or command' }));
    };
    await ask('Remember that my phone is on the shelf');
    await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    await ask('no');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await services.memory.list()).toHaveLength(0);
    await ask('Remember that my phone is on the shelf');
    await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    await ask('yes');
    await waitFor(() => expect(spoken(voice)).toContain('Saved.'));
    expect((await services.memory.list()).map((m) => m.subject)).toEqual(['phone']);
  });
});

describe('Camera and microphone cleanup', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('releases the camera and stops scanning when Find is closed mid-search', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { services, backend, camera } = setup(async () => ({
      find: { visibility: 'not_visible', position: '', confidence: 'medium', suggestion: '' },
    }));
    const { unmount } = renderApp('/find', services);
    await u.click(await screen.findByRole('button', { name: 'Keys' }));
    await u.click(screen.getByRole('button', { name: 'Start live search for Keys' }));
    await act(() => vi.advanceTimersByTimeAsync(1600));
    unmount();
    expect(camera.stop).toHaveBeenCalled();
    const calls = vi.mocked(backend.post).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 3));
    expect(backend.post).toHaveBeenCalledTimes(calls);
  });

  it('releases the camera when Live Explore is closed', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { services, camera, stream } = setup(async () => ({ task: 'describe', text: 'A desk.' }));
    const { unmount } = renderApp('/explore', services);
    await u.click(await screen.findByRole('button', { name: 'Start exploring' }));
    await screen.findByText('Camera on, waiting for your question');
    unmount();
    expect(camera.stop).toHaveBeenCalledWith(stream);
  });

  it('turns the microphone off when the voice conversation screen is closed', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { services, voice, sessions } = setup(async () => ({ text: 'unused' }));
    const { unmount } = renderApp('/explore', services);
    await u.click(await screen.findByRole('button', { name: 'Start Voice Conversation' }));
    await waitFor(() => expect(voice.startListening).toHaveBeenCalled());
    unmount();
    expect(sessions[sessions.length - 1].abort).toHaveBeenCalled();
  });
});

describe('API failure recovery', () => {
  it('shows a plain error in the Assistant and answers normally on the next try', async () => {
    const user = userEvent.setup();
    let call = 0;
    const { services } = setup(async () => {
      if (call++ === 0) throw new AIRequestError('network', 'Could not reach the OpenEyes server. Check your internet connection.');
      return { task: 'chat', text: 'Here is a tip for labelling spices.' };
    });
    renderApp('/assistant', services);
    await sendToAssistant(user, 'How can I label my spices?');
    expect(await screen.findByText('OpenEyes could not answer')).toBeInTheDocument();
    await sendToAssistant(user, 'How can I label my spices?');
    const list = within(await screen.findByRole('list', { name: 'Messages' }));
    expect(await list.findByText('Here is a tip for labelling spices.')).toBeInTheDocument();
  });

  it('does not start a guided task when the plan cannot be fetched, and recovers on retry', async () => {
    const user = userEvent.setup();
    let call = 0;
    const { services } = setup(async () => {
      if (call++ === 0) throw new AIRequestError('server', 'OpenEyes had a problem. Please try again.');
      return { plan: { steps: ['Fill the kettle.', 'Boil the water.'] } };
    });
    renderApp('/assistant', services);
    await sendToAssistant(user, 'Help me make coffee');
    const panel = () => within(screen.getByRole('region', { name: /Guided task/ }));
    await user.click(await screen.findByRole('button', { name: 'Start task' }));
    const list = within(screen.getByRole('list', { name: 'Messages' }));
    expect(await list.findByText(/The task was not started/)).toBeInTheDocument();
    await sendToAssistant(user, 'Help me make coffee');
    await user.click(await panel().findByRole('button', { name: 'Start task' }));
    expect(await panel().findByText(/Step 1 of 2: Fill the kettle\./)).toBeInTheDocument();
  });
});
