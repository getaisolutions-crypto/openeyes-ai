import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, createFakeVoice, createTestServices, renderApp } from '../test/utils';
import type { ListeningHandlers } from '../types/voice';

describe('accessibility of key screens', () => {
  it.each(['/', '/assistant', '/find', '/read', '/memory', '/devices', '/trusted-circle', '/settings'])(
    '%s has no detectable axe violations',
    async (route) => {
      const { container } = renderApp(route);
      await screen.findByRole('heading', { level: 1 });
      expect(await axeViolations(container)).toEqual([]);
    },
  );

  it('provides a skip link and live regions', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
    expect(screen.getByTestId('live-polite')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('live-assertive')).toHaveAttribute('aria-live', 'assertive');
  });

  it('dialogs trap focus, close with Escape and restore focus', async () => {
    const user = userEvent.setup();
    renderApp('/memory');
    const trigger = await screen.findByRole('button', { name: 'Add a memory' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Add a memory' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Memory')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('assistant honesty', () => {
  it('never fabricates a reply and shows an explicit error', async () => {
    const user = userEvent.setup();
    renderApp('/assistant');
    await user.type(await screen.findByLabelText('Type a message'), 'What is in front of me?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('OpenEyes could not answer')).toBeInTheDocument();
    expect(screen.getByText('What is in front of me?')).toBeInTheDocument();
    expect(screen.queryByText(/OpenEyes\s*said/)).not.toBeInTheDocument();
  });

  it('explains when voice input is unsupported', async () => {
    renderApp('/assistant');
    expect(await screen.findByText('Voice input not supported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start talking' })).not.toBeInTheDocument();
  });

  it('sends a real transcript from the voice provider', async () => {
    const user = userEvent.setup();
    let handlers: ListeningHandlers | undefined;
    const voice = createFakeVoice({
      isRecognitionSupported: () => true,
      startListening: vi.fn((h: ListeningHandlers) => {
        handlers = h;
        return { stop: vi.fn(), abort: vi.fn() };
      }),
    });
    renderApp('/assistant', createTestServices({ voice }));
    const mic = await screen.findByRole('button', { name: 'Start talking' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    await user.click(mic);
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      handlers!.onFinal('Where are my keys');
      handlers!.onEnd();
    });
    expect(await screen.findByText('Where are my keys')).toBeInTheDocument();
    expect(await screen.findByText('OpenEyes could not answer')).toBeInTheDocument();
  });
});
