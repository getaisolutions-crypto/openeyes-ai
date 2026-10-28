/**
 * States of a foreground voice conversation. `waiting` is the tap-to-talk fallback: the session is on but the
 * microphone is off until the user taps Talk (used when hands-free listening is off or unreliable).
 */
export type ConversationState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'user-speaking'
  | 'processing'
  | 'assistant-speaking'
  | 'interrupted'
  | 'waiting'
  | 'error'
  | 'stopped';

const TRANSITIONS: Record<ConversationState, readonly ConversationState[]> = {
  idle: ['starting'],
  starting: ['listening', 'assistant-speaking', 'waiting', 'error', 'stopped'],
  listening: ['user-speaking', 'processing', 'assistant-speaking', 'waiting', 'error', 'stopped'],
  'user-speaking': ['listening', 'processing', 'assistant-speaking', 'waiting', 'error', 'stopped'],
  processing: ['assistant-speaking', 'listening', 'waiting', 'interrupted', 'error', 'stopped'],
  'assistant-speaking': ['listening', 'waiting', 'interrupted', 'processing', 'error', 'stopped'],
  interrupted: ['listening', 'processing', 'waiting', 'error', 'stopped'],
  waiting: ['listening', 'interrupted', 'assistant-speaking', 'error', 'stopped'],
  error: ['listening', 'waiting', 'stopped'],
  stopped: ['starting'],
};

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const ACTIVE_STATES: readonly ConversationState[] = [
  'starting',
  'listening',
  'user-speaking',
  'processing',
  'assistant-speaking',
  'interrupted',
  'waiting',
  'error',
];

export const STATE_LABELS: Record<ConversationState, string> = {
  idle: 'Voice conversation off',
  starting: 'Starting voice conversation',
  listening: 'Listening. Microphone on',
  'user-speaking': 'Hearing you. Microphone on',
  processing: 'Thinking. Microphone off',
  'assistant-speaking': 'OpenEyes is speaking. Microphone off',
  interrupted: 'Interrupted',
  waiting: 'Microphone off. Tap Talk to speak',
  error: 'Voice problem',
  stopped: 'Voice conversation off',
};
