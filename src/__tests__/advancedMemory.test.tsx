import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import { createLocalMemoryProvider } from '../services/memory/localMemoryProvider';
import { buildMemoryExport } from '../services/memory/memoryExport';
import { parseItemLocation, parseReminderRequest, parseWhereIsQuestion, proposeMemory, REMINDER_LIMITATION } from '../services/memory/memoryIntent';
import { loadSettings } from '../services/settings/settingsStorage';
import { STORAGE_KEYS } from '../utils/storage';

beforeEach(() => localStorage.clear());

function setup(post: OpenEyesBackend['post'] = async () => ({ text: 'unused' })) {
  const backend: OpenEyesBackend = { post: vi.fn(post), health: vi.fn(async () => ({ configured: true })) };
  const services = createTestServices(createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'));
  return { services, backend };
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText('Type a message'), text);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

const messages = () => screen.getByRole('list', { name: 'Messages' });

describe('memory intent parsing', () => {
  it('understands item locations, reminders and where-is questions', () => {
    expect(parseItemLocation('My glasses are in the bedroom drawer')).toEqual({ item: 'glasses', location: 'in the bedroom drawer' });
    expect(parseItemLocation('I put my keys on the kitchen counter.')).toEqual({ item: 'keys', location: 'on the kitchen counter' });
    expect(parseWhereIsQuestion('Where did I leave my keys?')).toBe('keys');
    const reminder = parseReminderRequest('Remind me to call John tomorrow', new Date(2025, 0, 10, 15));
    expect(reminder).toMatchObject({ text: 'Call John.', category: 'reminder', done: false });
    expect(new Date(reminder!.dueAt!).getDate()).toBe(11);
  });

  it('asks the right consent question for each kind of memory', () => {
    expect(proposeMemory('my glasses are in the bedroom drawer').confirmPrompt).toBe('Would you like me to remember that location?');
    const pref = proposeMemory('I prefer short descriptions');
    expect(pref.confirmPrompt).toBe('Would you like me to save that as your description preference?');
    expect(pref.responseLength).toBe('brief');
    expect(proposeMemory('my doctor is Dr Patel').input.category).toBe('info');
  });
});

describe('memory consent in the assistant', () => {
  it('saves a location only after confirmation and replies "Saved."', async () => {
    const user = userEvent.setup();
    const { services, backend } = setup();
    renderApp('/assistant', services);
    await say(user, 'Remember that my glasses are in the bedroom drawer');
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    expect(within(dialog).getByText(/Would you like me to remember that location\?/)).toBeInTheDocument();
    expect(await services.memory.list()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    await waitFor(async () => expect(await services.memory.list()).toHaveLength(1));
    const [saved] = await services.memory.list();
    expect(saved).toMatchObject({ category: 'object-location', subject: 'glasses' });
    expect(services.voice.speak).toHaveBeenCalledWith('Saved.', expect.anything());
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('changes the description setting only after the user agrees', async () => {
    const user = userEvent.setup();
    const { services } = setup();
    renderApp('/assistant', services);
    await say(user, 'Remember that I prefer short descriptions');
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    expect(loadSettings().responseLength).toBe('standard');
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    await waitFor(() => expect(loadSettings().responseLength).toBe('brief'));
    expect(services.voice.speak).toHaveBeenCalledWith("I'll use shorter descriptions from now on.", expect.anything());
  });

  it('saves reminders with the background limitation stated', async () => {
    const user = userEvent.setup();
    const { services } = setup();
    renderApp('/assistant', services);
    await say(user, 'Remind me to check my appointment');
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this memory?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    expect(await screen.findByText(new RegExp(REMINDER_LIMITATION.slice(0, 40)))).toBeInTheDocument();
    expect((await services.memory.list())[0]).toMatchObject({ category: 'reminder', done: false });
  });
});

describe('memory retrieval', () => {
  it('answers where-is from memory, labelled as memory and not as a camera check', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'My keys are on the kitchen counter.', category: 'object-location', subject: 'keys' });
    await createLocalMemoryProvider().create({ text: 'My doctor is Dr Patel.', category: 'info' });
    const { services, backend } = setup();
    renderApp('/assistant', services);
    await say(user, 'Where did I leave my keys?');
    const reply = await within(messages()).findByText(/You last told me .*My keys are on the kitchen counter/);
    expect(reply.textContent).toMatch(/I haven't checked with the camera/);
    expect(within(messages()).getByText(/from your saved memories, not the camera/)).toBeInTheDocument();
    expect(within(messages()).queryByText(/Dr Patel/)).not.toBeInTheDocument();
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('says plainly when no location was saved', async () => {
    const user = userEvent.setup();
    const { services } = setup();
    renderApp('/assistant', services);
    await say(user, 'Where did I put my wallet?');
    expect(await within(messages()).findByText(/I don't have a saved location for your wallet/)).toBeInTheDocument();
  });

  it('shares only relevant memories with Meta AI', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'My umbrella is red.' });
    await createLocalMemoryProvider().create({ text: 'My bank is on Main Street.' });
    const { services, backend } = setup(async () => ({ text: 'Your umbrella is red, from your saved notes.' }));
    renderApp('/assistant', services);
    await say(user, 'What colour is my umbrella?');
    await within(messages()).findByText('Your umbrella is red, from your saved notes.');
    const sent = JSON.stringify(vi.mocked(backend.post).mock.calls[0][0]);
    expect(sent).toContain('umbrella is red');
    expect(sent).not.toContain('Main Street');
  });
});

describe('memory management', () => {
  it('keeps older memories without a category and shows them as notes', async () => {
    localStorage.setItem(
      STORAGE_KEYS.memories,
      JSON.stringify([{ id: 'old-1', text: 'Old note from 0.4.', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }]),
    );
    renderApp('/memory');
    const item = (await screen.findByText('Old note from 0.4.')).closest('li')!;
    expect(within(item).getByText('Note')).toBeInTheDocument();
    expect(await createLocalMemoryProvider().list()).toHaveLength(1);
  });

  it('filters by category and toggles reminders', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'Call John.', category: 'reminder', done: false });
    await createLocalMemoryProvider().create({ text: 'Keys on the hook.' });
    renderApp('/memory');
    await screen.findByText('Call John.');
    expect(screen.getByText(REMINDER_LIMITATION)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'reminder');
    expect(screen.queryByText('Keys on the hook.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark done: Call John.' }));
    await waitFor(async () => expect((await createLocalMemoryProvider().list())[0].done).toBe(true));
  });

  it('clears all memories only after confirmation', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'One.' });
    await createLocalMemoryProvider().create({ text: 'Two.' });
    renderApp('/memory');
    await user.click(await screen.findByRole('button', { name: 'Clear all memories' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Clear all memories?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await createLocalMemoryProvider().list()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Clear all memories' }));
    dialog = screen.getByRole('alertdialog', { name: 'Clear all memories?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete all memories' }));
    expect(await screen.findByText('You have not saved any memories yet.')).toBeInTheDocument();
    expect(await createLocalMemoryProvider().list()).toHaveLength(0);
  });

  it('exports memories as readable JSON', async () => {
    const m = await createLocalMemoryProvider().create({ text: 'Keys on the hook.', category: 'object-location', subject: 'keys' });
    const parsed = JSON.parse(buildMemoryExport([m]));
    expect(parsed.memories[0]).toMatchObject({ text: 'Keys on the hook.', category: 'Item location', item: 'keys' });
    expect(parsed.memories[0].id).toBeUndefined();

    const user = userEvent.setup();
    const create = vi.fn(() => 'blob:export');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderApp('/memory');
    await user.click(await screen.findByRole('button', { name: 'Export memories' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
