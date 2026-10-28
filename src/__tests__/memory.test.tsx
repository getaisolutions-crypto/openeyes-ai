import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/utils';
import { createLocalMemoryProvider } from '../services/memory/localMemoryProvider';
import { ValidationError } from '../services/storage/localCollection';
import { STORAGE_KEYS } from '../utils/storage';

describe('local memory provider', () => {
  it('creates, updates, searches and removes memories', async () => {
    const provider = createLocalMemoryProvider('test.memories');
    const keys = await provider.create({ text: '  I keep my keys on the table near the entrance.  ' });
    await provider.create({ text: 'My wallet is in the top drawer.' });
    expect(keys.text).toBe('I keep my keys on the table near the entrance.');
    expect(await provider.list()).toHaveLength(2);

    expect((await provider.search('KEYS table')).map((m) => m.id)).toEqual([keys.id]);

    const updated = await provider.update(keys.id, { text: 'Keys are on the hook.' });
    expect(updated.text).toBe('Keys are on the hook.');

    await provider.remove(keys.id);
    const remaining = await provider.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('My wallet is in the top drawer.');
  });

  it('rejects empty and oversized memories', async () => {
    const provider = createLocalMemoryProvider('test.memories');
    await expect(provider.create({ text: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.create({ text: 'a'.repeat(1001) })).rejects.toBeInstanceOf(ValidationError);
  });

  it('ignores malformed stored data', async () => {
    window.localStorage.setItem('test.memories', JSON.stringify([{ bogus: true }, 'x', null]));
    expect(await createLocalMemoryProvider('test.memories').list()).toEqual([]);
  });
});

describe('memory screen', () => {
  it('saves a memory only after the user presses Save', async () => {
    const user = userEvent.setup();
    renderApp('/memory');
    await user.click(await screen.findByRole('button', { name: 'Add a memory' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a memory' });
    await user.type(within(dialog).getByLabelText('Memory'), 'I keep my keys on the table near the entrance.');
    expect(window.localStorage.getItem(STORAGE_KEYS.memories)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    expect(await screen.findByText('I keep my keys on the table near the entrance.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.memories)!)).toHaveLength(1);
  });

  it('shows a validation error for an empty memory', async () => {
    const user = userEvent.setup();
    renderApp('/memory');
    await user.click(await screen.findByRole('button', { name: 'Add a memory' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a memory' });
    await user.click(within(dialog).getByRole('button', { name: 'Save memory' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Memory cannot be empty.');
  });

  it('edits and deletes a memory with confirmation', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'Glasses are by the sink.' });
    renderApp('/memory');

    await user.click(await screen.findByRole('button', { name: 'Edit memory: Glasses are by the sink.' }));
    const edit = screen.getByRole('dialog', { name: 'Edit memory' });
    const field = within(edit).getByLabelText('Memory');
    await user.clear(field);
    await user.type(field, 'Glasses are on the nightstand.');
    await user.click(within(edit).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Glasses are on the nightstand.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete memory: Glasses are on the nightstand.' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this memory?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete memory' }));
    await waitFor(() => expect(screen.queryByText('Glasses are on the nightstand.')).not.toBeInTheDocument());
    expect(screen.getByText('You have not saved any memories yet.')).toBeInTheDocument();
  });

  it('cancelling delete keeps the memory', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'Phone charger in kitchen.' });
    renderApp('/memory');
    await user.click(await screen.findByRole('button', { name: 'Delete memory: Phone charger in kitchen.' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Phone charger in kitchen.')).toBeInTheDocument();
  });

  it('filters memories by search', async () => {
    const user = userEvent.setup();
    const provider = createLocalMemoryProvider();
    await provider.create({ text: 'Keys on the hook.' });
    await provider.create({ text: 'Wallet in the drawer.' });
    renderApp('/memory');
    await screen.findByText('Keys on the hook.');
    await user.type(screen.getByLabelText('Search memories'), 'wallet');
    expect(screen.queryByText('Keys on the hook.')).not.toBeInTheDocument();
    expect(screen.getByText('Wallet in the drawer.')).toBeInTheDocument();
  });

  it('shows matching memories on the Find screen', async () => {
    const user = userEvent.setup();
    await createLocalMemoryProvider().create({ text: 'I keep my keys on the table near the entrance.' });
    renderApp('/find');
    await user.click(await screen.findByRole('button', { name: 'Keys' }));
    expect(await screen.findByText('I keep my keys on the table near the entrance.')).toBeInTheDocument();
  });
});
