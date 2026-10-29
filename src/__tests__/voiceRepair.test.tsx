import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/utils';
import {
  EMPTY_DIAGNOSTICS,
  applyDiagnostic,
  clearDiagnostics,
  formatDiagnosticsReport,
  readDiagnostics,
  writeDiagnostics,
} from '../services/voice/voiceDiagnostics';
import { META_MODELS } from '../services/ai/metaModels';

describe('voice diagnostics', () => {
  it('counts lifecycle events without storing any words', () => {
    let s = EMPTY_DIAGNOSTICS;
    s = applyDiagnostic(s, { kind: 'state', state: 'listening' });
    s = applyDiagnostic(s, { kind: 'restart', reason: 'silence', attempt: 0 });
    s = applyDiagnostic(s, { kind: 'resumed', afterMs: 412.4 });
    s = applyDiagnostic(s, { kind: 'auto-description', action: 'deferred' });
    s = applyDiagnostic(s, { kind: 'recognition-error', error: 'network' });
    expect(s.restartAttempts).toBe(1);
    expect(s.autoResumes).toBe(1);
    expect(s.lastResumeMs).toBe(412);
    expect(s.autoDescriptions.deferred).toBe(1);
    expect(s.lastRecognitionError).toBe('network');
    const report = formatDiagnosticsReport(s, '0.5.1');
    expect(report).toContain('version 0.5.1');
    expect(report).toContain('Last recognition error: network');
    expect(Object.keys(s)).not.toContain('transcript');
  });

  it('keeps the snapshot for this tab only and can be cleared', () => {
    writeDiagnostics({ ...EMPTY_DIAGNOSTICS, restartAttempts: 3 });
    expect(window.localStorage.length).toBe(0);
    expect(readDiagnostics().restartAttempts).toBe(3);
    clearDiagnostics();
    expect(readDiagnostics().restartAttempts).toBe(0);
  });
});

describe('settings accuracy', () => {
  it('labels Muse Voice Transcribe as connected through the server, not planned', () => {
    expect(META_MODELS.find((m) => m.id === 'muse-voice-transcribe')?.status).toBe('integrated');
  });

  it('no longer claims nothing is ever sent to servers and explains what is', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: /^Voice diagnostics/ });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/nothing you save, say or photograph is sent/i);
    expect(text).toMatch(/Kept on this device only/);
    expect(text).toMatch(/Sent to the OpenEyes server, then to Meta AI/);
    expect(text).toMatch(/removed after 24 hours/);
  });

  it('offers a copyable privacy-safe voice report', async () => {
    renderApp('/settings');
    const heading = await screen.findByRole('heading', { name: /^Voice diagnostics/ });
    const section = heading.closest('section') ?? document.body;
    expect(within(section as HTMLElement).getByLabelText('Privacy-safe report')).toHaveAttribute('readonly');
    expect(within(section as HTMLElement).getByRole('button', { name: 'Copy report' })).toBeInTheDocument();
  });
});
