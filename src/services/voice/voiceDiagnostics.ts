import type { SpeechErrorKind, SpeechRecognizer } from '../../types/voice';
import type { ConversationState } from './conversationStateMachine';
import type { MicrophonePermission, TurnMetrics, VoiceDiagnosticEvent } from './voiceConversationEngine';

/** Kept only for this browser tab (sessionStorage). Holds states, error categories and timings, never words or audio. */
const KEY = 'openeyes.voice-diagnostics.v1';

export interface VoiceDiagnosticsSnapshot {
  updatedAt: string | null;
  selectedProvider: 'meta' | 'browser';
  activeProvider: SpeechRecognizer['id'] | null;
  microphonePermission: MicrophonePermission;
  cameraOn: boolean;
  conversationState: ConversationState;
  lastRecognitionError: SpeechErrorKind | null;
  lastSpeechOutputError: string | null;
  lastProviderFailure: string | null;
  restartAttempts: number;
  autoResumes: number;
  lastResumeMs: number | null;
  handsFreePaused: string | null;
  autoDescriptions: { deferred: number; dropped: number; spoken: number };
  lastTurn: Omit<TurnMetrics, 'turnId'> | null;
}

export const EMPTY_DIAGNOSTICS: VoiceDiagnosticsSnapshot = {
  updatedAt: null,
  selectedProvider: 'browser',
  activeProvider: null,
  microphonePermission: 'unknown',
  cameraOn: false,
  conversationState: 'idle',
  lastRecognitionError: null,
  lastSpeechOutputError: null,
  lastProviderFailure: null,
  restartAttempts: 0,
  autoResumes: 0,
  lastResumeMs: null,
  handsFreePaused: null,
  autoDescriptions: { deferred: 0, dropped: 0, spoken: 0 },
  lastTurn: null,
};

export function applyDiagnostic(s: VoiceDiagnosticsSnapshot, event: VoiceDiagnosticEvent): VoiceDiagnosticsSnapshot {
  switch (event.kind) {
    case 'state':
      return { ...s, conversationState: event.state, handsFreePaused: event.state === 'listening' ? null : s.handsFreePaused };
    case 'recognition-error':
      return { ...s, lastRecognitionError: event.error };
    case 'restart':
      return { ...s, restartAttempts: s.restartAttempts + 1 };
    case 'resumed':
      return { ...s, autoResumes: s.autoResumes + 1, lastResumeMs: Math.round(event.afterMs) };
    case 'speech-error':
      return { ...s, lastSpeechOutputError: 'Speech end was not reported; listening resumed after a timeout' };
    case 'auto-description':
      return { ...s, autoDescriptions: { ...s.autoDescriptions, [event.action]: s.autoDescriptions[event.action] + 1 } };
    case 'paused-hands-free':
      return { ...s, handsFreePaused: event.reason };
  }
}

export function readDiagnostics(): VoiceDiagnosticsSnapshot {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? { ...EMPTY_DIAGNOSTICS, ...(JSON.parse(raw) as Partial<VoiceDiagnosticsSnapshot>) } : EMPTY_DIAGNOSTICS;
  } catch {
    return EMPTY_DIAGNOSTICS;
  }
}

export function writeDiagnostics(snapshot: VoiceDiagnosticsSnapshot) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }));
  } catch {
    // Diagnostics are optional.
  }
}

export function clearDiagnostics() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Diagnostics are optional.
  }
}

const ms = (v: number | null) => (v === null ? 'not measured' : `${Math.round(v)} ms`);

/** Plain-text report safe to share: no transcripts, audio, images or keys. */
export function formatDiagnosticsReport(s: VoiceDiagnosticsSnapshot, version: string): string {
  const t = s.lastTurn;
  return [
    `OpenEyes voice diagnostics (version ${version})`,
    `Recorded: ${s.updatedAt ?? 'no session yet'}`,
    `Recognition selected: ${s.selectedProvider === 'meta' ? 'Meta Voice' : 'Browser'}`,
    `Recognition active: ${s.activeProvider === 'meta-voice' ? 'Meta Voice' : s.activeProvider === 'browser' ? 'Browser' : 'none'}`,
    `Microphone permission: ${s.microphonePermission}`,
    `Camera: ${s.cameraOn ? 'on' : 'off'}`,
    `Conversation state: ${s.conversationState}`,
    `Last recognition error: ${s.lastRecognitionError ?? 'none'}`,
    `Last speech output error: ${s.lastSpeechOutputError ?? 'none'}`,
    `Last provider failure: ${s.lastProviderFailure ?? 'none'}`,
    `Listening restarts: ${s.restartAttempts}`,
    `Automatic listening resumed: ${s.autoResumes} times (last after ${ms(s.lastResumeMs)})`,
    `Hands-free paused: ${s.handsFreePaused ?? 'no'}`,
    `Automatic descriptions: ${s.autoDescriptions.spoken} spoken, ${s.autoDescriptions.deferred} held back, ${s.autoDescriptions.dropped} dropped`,
    `Last turn: first words ${ms(t?.firstTranscriptMs ?? null)}, reply ${ms(t?.responseMs ?? null)}, speech start ${ms(t?.playbackStartMs ?? null)}, speech length ${ms(t?.playbackMs ?? null)}, listening again ${ms(t?.resumeListeningMs ?? null)}`,
  ].join('\n');
}
