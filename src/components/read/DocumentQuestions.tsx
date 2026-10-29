import { useId, useState, type FormEvent } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { MicButton } from '../MicButton';
import { Notice } from '../Notice';
import { AIPending } from '../AIResult';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import type { ReadingTurn } from '../../hooks/useReadingSession';

interface DocumentQuestionsProps {
  turns: ReadingTurn[];
  asking: boolean;
  error: string | null;
  disabled: boolean;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

export function DocumentQuestions({ turns, asking, error, disabled, onAsk, onCancel }: DocumentQuestionsProps) {
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const speech = useSpeechRecognition({
    onFinal: (text) => {
      setQuestion('');
      onAsk(text);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    onAsk(question);
    setQuestion('');
  };

  return (
    <section aria-labelledby="ask-text-heading" className="card mt-4 p-5">
      <h2 id="ask-text-heading" className="flex items-center gap-2 text-xl font-bold">
        <MessageCircleQuestion aria-hidden="true" className="h-6 w-6 text-primary" /> Ask about this text
      </h2>
      <p className="mt-1 text-muted">
        Questions use the same photo until you take a new one. For example: &ldquo;What&apos;s the deadline?&rdquo;,
        &ldquo;Read the second paragraph&rdquo; or &ldquo;Read it again&rdquo;.
      </p>
      <form onSubmit={submit} className="mt-3">
        <label htmlFor={fieldId} className="label">
          Your question
        </label>
        <div className="flex items-center gap-3">
          <input
            id={fieldId}
            className="field text-lg"
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={disabled}
            autoComplete="off"
          />
          {speech.supported && !disabled && (
            <MicButton size="md" listening={speech.listening} onStart={speech.start} onStop={speech.stop} idleLabel="Say your question" />
          )}
        </div>
        <button type="submit" className="btn-primary mt-3 w-full" disabled={disabled || asking || !question.trim()}>
          Ask
        </button>
      </form>
      {disabled && <p className="mt-2 text-muted">Take or choose a photo of the text first.</p>}
      {speech.error && (
        <p role="alert" className="mt-2 font-bold text-danger">
          {SPEECH_ERROR_MESSAGES[speech.error]}
        </p>
      )}
      {asking && <AIPending label="Checking the text" onCancel={onCancel} />}
      {error && (
        <div className="mt-3">
          <Notice variant="error" title="Could not answer">
            {error}
          </Notice>
        </div>
      )}
      {turns.length > 0 && (
        <ol aria-label="Answers about this text" className="mt-4 space-y-3">
          {turns.map((turn) => (
            <li key={turn.id} className="rounded-xl bg-surface-2 p-3">
              <p className="text-sm font-bold text-muted">You asked: {turn.question}</p>
              <p className="mt-1 text-sm font-bold">{turn.label}</p>
              <p className="mt-1 whitespace-pre-line text-lg">{turn.reply}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
