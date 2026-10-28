import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/utils';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings } from '../services/settings/settingsStorage';
import { STORAGE_KEYS } from '../utils/storage';

describe('settings storage', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('discards invalid values and clamps speech rate', () => {
    const s = sanitizeSettings({ theme: 'neon', textSize: 'xlarge', speechRate: 9, highContrast: 'yes', cameraSource: 'meta-glasses' });
    expect(s.theme).toBe('dark');
    expect(s.textSize).toBe('xlarge');
    expect(s.speechRate).toBe(2);
    expect(s.highContrast).toBe(false);
    expect(s.cameraSource).toBe('phone');
  });

  it('survives corrupted JSON', () => {
    window.localStorage.setItem(STORAGE_KEYS.settings, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('settings screen', () => {
  it('persists theme, contrast and text size across reloads', async () => {
    const user = userEvent.setup();
    const first = renderApp('/settings');
    await user.click(await screen.findByRole('radio', { name: 'Light' }));
    await user.click(screen.getByRole('switch', { name: 'High contrast' }));
    await user.click(screen.getByRole('radio', { name: 'Largest' }));

    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.contrast).toBe('high');
    expect(root.dataset.textSize).toBe('xxlarge');
    first.unmount();

    renderApp('/settings');
    expect(await screen.findByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'High contrast' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Largest' })).toBeChecked();
  });

  it('keeps proactive frequency disabled in reactive-only mode and labels it as planned', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    expect(await screen.findByRole('radio', { name: 'Low' })).toBeDisabled();
    expect(screen.getByText(/does not watch your surroundings/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Reactive and proactive/ }));
    expect(screen.getByRole('radio', { name: 'Low' })).toBeEnabled();
    expect(loadSettings().assistanceMode).toBe('reactive-proactive');
  });

  it('stop announcements turns on quiet mode', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Stop announcements' }));
    expect(screen.getByRole('switch', { name: 'Quiet mode' })).toHaveAttribute('aria-checked', 'true');
    expect(loadSettings().quietMode).toBe(true);
  });

  it('deletes all local data after confirmation', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEYS.memories, '[]');
    window.localStorage.setItem('unrelated.key', 'keep');
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Delete all OpenEyes data on this device' }));
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(window.localStorage.getItem(STORAGE_KEYS.memories)).toBeNull();
    expect(window.localStorage.getItem('unrelated.key')).toBe('keep');
  });
});
