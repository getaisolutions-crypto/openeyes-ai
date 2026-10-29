import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import type { CapturedImage } from '../types/camera';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

const photo: CapturedImage = {
  blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
  previewUrl: 'blob:test-photo',
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone',
};

type Post = OpenEyesBackend['post'];

function servicesWith(post: Post) {
  const backend: OpenEyesBackend = {
    post: vi.fn(post),
    health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
  };
  const providers = createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA');
  const services = createTestServices({ ...providers, camera: createFakeCamera({ capture: vi.fn(async () => photo) }) });
  return { services, backend };
}

async function takePhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
  await user.click(await screen.findByRole('button', { name: 'Capture photo' }));
}

describe('AI screens with a mocked OpenEyes server', () => {
  it('describes a photo only when asked and does not read it aloud automatically', async () => {
    const user = userEvent.setup();
    const { services, backend } = servicesWith(async () => ({ task: 'describe', text: 'A table with a red mug on the right.' }));
    renderApp('/explore', services);
    await takePhoto(user);
    expect(backend.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Describe my surroundings' }));
    expect(await screen.findByText('A table with a red mug on the right.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What OpenEyes sees' })).toBeInTheDocument();
    expect(services.voice.speak).not.toHaveBeenCalled();
  });

  it('lets the user cancel a description in progress', async () => {
    const user = userEvent.setup();
    const { services } = servicesWith(
      (_payload, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    renderApp('/explore', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Describe my surroundings' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
    expect(screen.queryByText('Could not describe the photo')).not.toBeInTheDocument();
  });

  it('shows a clear error when the server has no Meta key', async () => {
    const user = userEvent.setup();
    const { AIRequestError } = await import('../types/ai');
    const { services } = servicesWith(async () => {
      throw new AIRequestError('not-configured', 'Meta AI is not set up on the OpenEyes server yet.');
    });
    renderApp('/explore', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Describe my surroundings' }));
    expect(await screen.findByText('Could not describe the photo')).toBeInTheDocument();
  });

  it('reports an object that is not in the photo', async () => {
    const user = userEvent.setup();
    const { services } = servicesWith(async () => ({
      task: 'find',
      find: { visibility: 'not_visible', position: '', confidence: 'medium', suggestion: 'Try pointing at the table.' },
    }));
    renderApp('/find', services);
    await user.type(await screen.findByLabelText('What are you looking for?'), 'keys');
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Find keys in photo' }));
    expect(await screen.findByRole('heading', { name: /Not seen: keys/ })).toBeInTheDocument();
    expect(screen.getByText('Try pointing at the table.')).toBeInTheDocument();
    expect(screen.queryByText('Where')).not.toBeInTheDocument();
  });

  it('says when no text could be read', async () => {
    const user = userEvent.setup();
    const { services } = servicesWith(async () => ({ task: 'read', text: '', readable: false }));
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Read text from photo' }));
    expect(await screen.findByText('No readable text found')).toBeInTheDocument();
  });

  it('puts read text into the read-aloud box with its line breaks', async () => {
    const user = userEvent.setup();
    const { services } = servicesWith(async () => ({ task: 'read', text: 'Aspirin\nTake 2 tablets', readable: true }));
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Read text from photo' }));
    expect(await screen.findByText('Text found')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('Aspirin\nTake 2 tablets');
  });
});

describe('Assistant memory and context', () => {
  it('asks before saving a "remember that" request and saves nothing on cancel', async () => {
    const user = userEvent.setup();
    const { services, backend } = servicesWith(async () => ({ task: 'chat', text: 'unused' }));
    renderApp('/assistant', services);
    await user.type(await screen.findByLabelText('Type a message'), 'Remember that my keys are on the hook');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    expect(within(dialog).getByText(/My keys are on the hook\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await services.memory.list()).toHaveLength(0);
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('saves the memory after confirmation', async () => {
    const user = userEvent.setup();
    const { services, backend } = servicesWith(async () => ({ task: 'chat', text: 'unused' }));
    renderApp('/assistant', services);
    await user.type(await screen.findByLabelText('Type a message'), 'Remember that my keys are on the hook');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    expect(await screen.findByText('Memory saved')).toBeInTheDocument();
    const saved = await services.memory.list();
    expect(saved.map((m) => m.text)).toEqual(['My keys are on the hook.']);
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('shares relevant saved notes as background, not as camera evidence', async () => {
    const user = userEvent.setup();
    const { services, backend } = servicesWith(async () => ({ task: 'chat', text: 'You saved a note that your keys are on the hook.' }));
    await services.memory.create({ text: 'My keys are on the hook.' });
    await services.memory.create({ text: 'The bakery is next to the bus stop.' });
    renderApp('/assistant', services);
    await user.type(await screen.findByLabelText('Type a message'), 'Where are my keys?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('You saved a note that your keys are on the hook.')).toBeInTheDocument();
    const payload = (backend.post as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.memories).toEqual(['My keys are on the hook.']);
    expect(payload.image).toBeUndefined();
    expect(screen.getByText(/1 saved memory shared as background/)).toBeInTheDocument();
  });
});
