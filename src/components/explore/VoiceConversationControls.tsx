import { Ear, Loader2, Mic, MicOff, PhoneOff } from 'lucide-react';
import { Notice } from '../Notice';
import { STATE_LABELS } from '../../services/voice/conversationStateMachine';
import type { VoiceConversation } from '../../hooks/useVoiceConversation';
import type { TurnMetrics } from '../../services/voice/voiceConversationEngine';
import type { SpeechRecognizer } from '../../types/voice';

interface Props {
  conversation: VoiceConversation;
  showDiagnostics: boolean;
  wakePhrase: boolean;
  onRequestStart: () => void;
}

const ms = (value: number | null) => (value === null ? 'not measured' : `${Math.round(value)} ms`);

function Diagnostics({ metrics, recognizer }: { metrics: TurnMetrics | null; recognizer: SpeechRecognizer['id'] }) {
  return (
    <details className="w-full rounded-xl border-2 border-line p-3 text-left">
      <summary className="cursor-pointer font-bold">Voice timing details (testing)</summary>
      {metrics ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Listening with</dt>
          <dd>{recognizer === 'meta-voice' ? 'Meta Voice' : 'Browser'}</dd>
          <dt className="text-muted">First words</dt>
          <dd>{ms(metrics.firstTranscriptMs)}</dd>
          <dt className="text-muted">Final words</dt>
          <dd>{ms(metrics.recognitionMs)}</dd>
          <dt className="text-muted">Meta AI reply</dt>
          <dd>{ms(metrics.responseMs)}</dd>
          <dt className="text-muted">Speech start</dt>
          <dd>{ms(metrics.playbackStartMs)}</dd>
          <dt className="text-muted">End to end</dt>
          <dd>{ms(metrics.endToEndMs)}</dd>
          <dt className="text-muted">Speech length</dt>
          <dd>{ms(metrics.playbackMs)}</dd>
          <dt className="text-muted">Listening again</dt>
          <dd>{ms(metrics.resumeListeningMs)}</dd>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">No turn measured yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">Only timings are shown. No words or audio are kept.</p>
    </details>
  );
}

export function VoiceConversationControls({ conversation, showDiagnostics, wakePhrase, onRequestStart }: Props) {
  const { state, active, supported } = conversation;

  if (!active) {
    return (
      <div className="w-full space-y-3">
        <button type="button" className="btn-primary w-full text-lg" disabled={!supported || state === 'starting'} onClick={onRequestStart}>
          <Ear aria-hidden="true" className="h-6 w-6" /> Start Voice Conversation
        </button>
        <p className="text-sm text-muted">
          Talk back and forth without tapping for every question. The microphone is only on while the conversation runs.
        </p>
        {!supported && (
          <Notice variant="warning" title="Voice conversation not available">
            This browser cannot recognize speech. Try Chrome on Android, or type your question below.
          </Notice>
        )}
      </div>
    );
  }

  const listening = state === 'listening' || state === 'user-speaking';
  const busy = state === 'processing' || state === 'interrupted' || state === 'starting';
  const talkLabel =
    state === 'assistant-speaking' || busy ? 'Interrupt and talk' : listening ? 'Listening now' : 'Talk';

  return (
    <div className="w-full space-y-3">
      <p className="flex items-center justify-center gap-2 text-lg font-bold">
        <span
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 rounded-full ${
            listening ? 'bg-red-500 motion-safe:animate-pulse' : state === 'waiting' ? 'bg-amber-400' : 'bg-primary'
          }`}
        />
        {STATE_LABELS[state]}
      </p>
      <p className="text-sm text-muted">
        Speech recognition: {conversation.recognizerId === 'meta-voice' ? 'Meta Voice' : 'browser'}
      </p>
      {conversation.interim && <p className="text-muted">{conversation.interim}</p>}
      {conversation.bargeInListening && (
        <p className="text-sm text-muted">Listening for interruptions while OpenEyes speaks (experimental).</p>
      )}
      {wakePhrase && <p className="text-sm text-muted">Start each request with &quot;Hey OpenEyes&quot; (experimental).</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="btn-primary min-h-[64px] text-lg"
          disabled={listening}
          onClick={conversation.interrupt}
          aria-label={listening ? 'Listening now. Microphone on' : `${talkLabel}. Stops speech and listens`}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="h-6 w-6 motion-safe:animate-spin" />
          ) : listening ? (
            <Mic aria-hidden="true" className="h-6 w-6" />
          ) : (
            <MicOff aria-hidden="true" className="h-6 w-6" />
          )}
          {talkLabel}
        </button>
        <button type="button" className="btn-danger min-h-[64px] text-lg" onClick={conversation.stop}>
          <PhoneOff aria-hidden="true" className="h-6 w-6" /> Stop conversation
        </button>
      </div>
      {showDiagnostics && <Diagnostics metrics={conversation.metrics} recognizer={conversation.recognizerId} />}
    </div>
  );
}
