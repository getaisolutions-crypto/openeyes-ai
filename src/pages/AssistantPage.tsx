import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle, Send, Trash2, VolumeX } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { MicButton } from '../components/MicButton';
import { ConfirmDialog } from '../components/Dialog';
import { useServices } from '../services/ServicesContext';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { ProviderUnavailableError, type ChatMessage } from '../types/ai';
import { createId } from '../utils/id';
import { LIMITS, validateRequiredText } from '../utils/validation';
import { STORAGE_KEYS, readJSON, removeKey, writeJSON } from '../utils/storage';
import { formatDateTime } from '../utils/format';

function isChatMessage(value: unknown): value is ChatMessage {
  const v = value as ChatMessage;
  return (
    typeof v === 'object' && v !== null && typeof v.id === 'string' && typeof v.content === 'string' &&
    (v.role === 'user' || v.role === 'assistant') && typeof v.createdAt === 'string'
  );
}

function loadConversation(enabled: boolean): ChatMessage[] {
  if (!enabled) return [];
  const raw = readJSON<unknown>(STORAGE_KEYS.conversation, []);
  return Array.isArray(raw) ? raw.filter(isChatMessage) : [];
}

export default function AssistantPage() {
  const { ai, voice } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const location = useLocation();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadConversation(settings.rememberConversation));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listEndRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (settings.rememberConversation) writeJSON(STORAGE_KEYS.conversation, messages);
    else removeKey(STORAGE_KEYS.conversation);
  }, [messages, settings.rememberConversation]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (raw: string, inputMode: 'voice' | 'text') => {
      const result = validateRequiredText(raw, 'Message', LIMITS.chatMessage);
      if (!result.ok) {
        setInputError(result.error);
        return;
      }
      setInputError(null);
      setError(null);
      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: result.value,
        createdAt: new Date().toISOString(),
        inputMode,
      };
      const history = [...messages, userMessage];
      setMessages(history);
      setDraft('');
      setPending(true);
      announce('Message sent. Waiting for OpenEyes.');

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await ai.sendMessage({
          messages: history,
          responseLength: settings.responseLength,
          signal: controller.signal,
        });
        setMessages((prev) => [...prev, response.message]);
        announce(`OpenEyes said: ${response.message.content}`);
        if (settings.voiceOutput && !settings.quietMode) {
          voice.speak(response.message.content, { rate: settings.speechRate });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof ProviderUnavailableError
            ? err.message
            : 'Something went wrong and OpenEyes could not answer. Please try again.';
        setError(message);
        announce(message, 'assertive');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
      }
    },
    [ai, announce, messages, settings, voice],
  );

  const speech = useSpeechRecognition({ onFinal: (text) => void send(text, 'voice') });

  const autoListenHandled = useRef(false);
  useEffect(() => {
    const state = location.state as { autoListen?: boolean } | null;
    if (autoListenHandled.current || !state?.autoListen) return;
    autoListenHandled.current = true;
    navigate(location.pathname, { replace: true, state: null });
    speech.start();
  }, [location, navigate, speech]);

  useEffect(() => {
    if (speech.listening) announce('Listening. Speak now.');
  }, [speech.listening, announce]);

  useEffect(() => {
    if (speech.error) announce(SPEECH_ERROR_MESSAGES[speech.error], 'assertive');
  }, [speech.error, announce]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft, 'text');
  };

  const clearConversation = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setConfirmClear(false);
    announce('Conversation cleared.');
  };

  return (
    <>
      <PageHeader
        title="Assistant"
        icon={<MessageCircle className="h-7 w-7" />}
        description="Ask a question by voice or by typing."
      />

      <Notice variant="warning" title="AI answers not available yet">
        OpenEyes is not yet connected to Meta AI, so it cannot reply. Your messages stay on this device. Voice input and
        the controls on this screen work today.
      </Notice>

      <section aria-label="Voice input" className="card mt-4 flex flex-col items-center gap-4 p-6 text-center">
        {speech.supported ? (
          <>
            <MicButton listening={speech.listening} onStart={speech.start} onStop={speech.stop} idleLabel="Start talking" />
            <p className="text-lg font-bold" aria-hidden="true">
              {speech.listening ? 'Listening... tap to stop' : 'Tap to talk'}
            </p>
            {speech.interim && (
              <p className="text-lg text-muted">
                <span className="sr-only">Heard so far: </span>
                {speech.interim}
              </p>
            )}
            <p className="text-sm text-muted">
              Voice input uses your browser&apos;s built-in speech service. Some browsers, such as Chrome, process speech
              on their own online servers.
            </p>
          </>
        ) : (
          <Notice variant="info" title="Voice input not supported">
            {SPEECH_ERROR_MESSAGES.unsupported}
          </Notice>
        )}
        {speech.error && speech.error !== 'unsupported' && (
          <Notice variant="error" title="Voice input problem">
            {SPEECH_ERROR_MESSAGES[speech.error]}
          </Notice>
        )}
      </section>

      <section aria-labelledby="conversation-heading" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="conversation-heading" className="text-xl font-bold">
            Conversation
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                voice.stopSpeaking();
                announce('Stopped speaking.');
              }}
              disabled={!voice.isSynthesisSupported()}
            >
              <VolumeX aria-hidden="true" className="h-5 w-5" /> Stop speaking
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirmClear(true)} disabled={messages.length === 0}>
              <Trash2 aria-hidden="true" className="h-5 w-5" /> Clear
            </button>
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="mt-3 text-muted">No messages yet.</p>
        ) : (
          <ol className="mt-4 space-y-3" aria-label="Messages">
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 animate-fade-up ${
                    m.role === 'user' ? 'bg-primary text-on-primary' : 'border border-line bg-surface-2'
                  }`}
                >
                  <p className="text-sm font-bold opacity-80">
                    {m.role === 'user' ? 'You' : 'OpenEyes'}
                    {m.inputMode === 'voice' ? ', by voice' : ''}
                    <span className="sr-only"> said</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-lg">{m.content}</p>
                  <p className="mt-1 text-xs opacity-70">{formatDateTime(m.createdAt)}</p>
                </div>
              </li>
            ))}
            <li ref={listEndRef} aria-hidden="true" />
          </ol>
        )}

        {pending && (
          <div role="status" className="mt-3 flex items-center gap-2 text-muted">
            <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" /> Waiting for OpenEyes
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice variant="error" title="OpenEyes could not answer">
              {error}
            </Notice>
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} className="mt-6" noValidate>
        <label htmlFor="chat-input" className="label">
          Type a message
        </label>
        <div className="flex gap-2">
          <textarea
            id="chat-input"
            rows={2}
            value={draft}
            maxLength={LIMITS.chatMessage}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft, 'text');
              }
            }}
            aria-invalid={Boolean(inputError)}
            aria-describedby={inputError ? 'chat-input-error' : undefined}
            className="field flex-1 resize-none text-lg"
            placeholder="What is in front of me?"
          />
          <button type="submit" className="btn-primary min-w-[56px] px-4" disabled={pending} aria-label="Send message">
            <Send aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>
        {inputError && (
          <p id="chat-input-error" className="mt-2 font-bold text-danger">
            {inputError}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={confirmClear}
        title="Clear conversation?"
        message="This removes all messages in this conversation from this device."
        confirmLabel="Clear conversation"
        destructive
        onConfirm={clearConversation}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
