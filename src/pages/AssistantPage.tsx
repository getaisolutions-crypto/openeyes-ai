import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle, Send, Trash2, VolumeX, X } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/Notice';
import { MicButton } from '../components/MicButton';
import { ConfirmDialog } from '../components/Dialog';
import { PhotoAttachment } from '../components/PhotoAttachment';
import { useServices } from '../services/ServicesContext';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { aiErrorMessage } from '../hooks/useAIRequest';
import { SPEECH_ERROR_MESSAGES, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { TaskPanel } from '../components/assistant/TaskPanel';
import { useTaskSession } from '../hooks/useTaskSession';
import { selectRelevantMemories } from '../services/ai/conversationContext';
import { routeIntent, type Intent } from '../services/assistant/intentRouter';
import { findRememberedLocation, phraseRememberedLocation, yourItem } from '../services/find/objectSearch';
import { REMINDER_LIMITATION, proposeMemory, type MemoryProposal } from '../services/memory/memoryIntent';
import type { ChatMessage } from '../types/ai';
import type { CapturedImage } from '../types/camera';
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

/** Longer replies are not spoken automatically; the user can still read them or use their screen reader. */
const AUTO_SPEAK_MAX_CHARS = 300;

function loadConversation(enabled: boolean): ChatMessage[] {
  if (!enabled) return [];
  const raw = readJSON<unknown>(STORAGE_KEYS.conversation, []);
  return Array.isArray(raw) ? raw.filter(isChatMessage) : [];
}

export default function AssistantPage() {
  const { ai, voice, memory } = useServices();
  const aiStatus = ai.getStatus();
  const { settings, updateSettings } = useSettings();
  const { announce } = useAnnouncer();
  const location = useLocation();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadConversation(settings.rememberConversation));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [photo, setPhoto] = useState<CapturedImage | null>(null);
  const [pendingMemory, setPendingMemory] = useState<MemoryProposal | null>(null);
  const task = useTaskSession();
  const [memoryNotice, setMemoryNotice] = useState<{ ok: boolean; text: string } | null>(null);
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

  const speakReply = useCallback(
    (text: string) => {
      if (settings.voiceOutput && !settings.quietMode && text.length <= AUTO_SPEAK_MAX_CHARS) {
        voice.speak(text, { rate: settings.speechRate });
      }
    },
    [settings.voiceOutput, settings.quietMode, settings.speechRate, voice],
  );

  const addLocalReply = useCallback(
    (text: string, source: ChatMessage['source']) => {
      const reply: ChatMessage = { id: createId(), role: 'assistant', content: text, createdAt: new Date().toISOString(), source };
      setMessages((prev) => [...prev, reply]);
      announce(`OpenEyes said: ${text}`);
      speakReply(text);
    },
    [announce, speakReply],
  );

  /** Requests handled on the device or by another screen. Returns null when Meta AI should answer instead. */
  const localReply = useCallback(
    async (intent: Intent): Promise<{ text: string; source: ChatMessage['source']; after?: () => void } | null> => {
      switch (intent.kind) {
        case 'task-command':
          return { text: (await task.command(intent.command)) || 'Task stopped.', source: 'task' };
        case 'task':
          return { text: task.offer(intent.task), source: 'task' };
        case 'where-is': {
          const saved = await memory.list().catch(() => []);
          const found = findRememberedLocation(saved, intent.item);
          // Other notes may mention the item; let Meta AI answer with those as background.
          if (!found && selectRelevantMemories(saved, intent.item).length > 0) return null;
          const check = `To check with the camera, say "find my ${intent.item}".`;
          return {
            text: found
              ? `${phraseRememberedLocation(found, intent.item)} ${check}`
              : `I don't have a saved location for ${yourItem(intent.item)}. ${check}`,
            source: 'memory',
          };
        }
        case 'find':
          return {
            text: `Opening Find to look for ${yourItem(intent.item)}.`,
            source: 'app',
            after: () => navigate('/find', { state: { object: intent.item } }),
          };
        case 'read':
          return { text: 'Opening Read. Take a photo of the text.', source: 'app', after: () => navigate('/read') };
        case 'explore':
          return { text: 'Opening Live Explore.', source: 'app', after: () => navigate('/explore') };
        default:
          return null;
      }
    },
    [memory, navigate, task],
  );

  const send = useCallback(
    async (raw: string, inputMode: 'voice' | 'text') => {
      const result = validateRequiredText(raw, 'Message', LIMITS.chatMessage);
      if (!result.ok) {
        setInputError(result.error);
        return;
      }
      setInputError(null);
      setError(null);
      setMemoryNotice(null);

      const intent = routeIntent(result.value, { taskActive: task.open, hasPhoto: Boolean(photo) });

      if (intent.kind === 'remember' || intent.kind === 'reminder') {
        setDraft('');
        const proposal =
          intent.kind === 'remember'
            ? proposeMemory(intent.note)
            : {
                input: intent.input,
                confirmPrompt: 'Would you like me to save this reminder?',
                savedReply: `Reminder saved. ${REMINDER_LIMITATION}`,
              };
        setPendingMemory(proposal);
        announce(`${proposal.confirmPrompt} OpenEyes needs your confirmation before saving this memory.`);
        speakReply(proposal.confirmPrompt);
        return;
      }

      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: result.value,
        createdAt: new Date().toISOString(),
        inputMode,
        photoAttached: Boolean(photo),
      };
      const history = [...messages, userMessage];
      setMessages(history);
      setDraft('');

      if (intent.kind !== 'chat') {
        const local = await localReply(intent);
        if (local) {
          addLocalReply(local.text, local.source);
          local.after?.();
          return;
        }
      }

      setPending(true);
      announce(photo ? 'Message and photo sent. Waiting for OpenEyes.' : 'Message sent. Waiting for OpenEyes.');

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const saved = await memory.list().catch(() => []);
        const memories = selectRelevantMemories(saved, result.value).map((m) => m.text);
        const response = await ai.sendMessage({
          messages: history,
          responseLength: settings.responseLength,
          image: photo ?? undefined,
          memories,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const reply: ChatMessage = { ...response.message, memoriesShared: memories.length || undefined };
        setMessages((prev) => [...prev, reply]);
        announce(`OpenEyes said: ${reply.content}`);
        speakReply(reply.content);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = aiErrorMessage(err);
        setError(message);
        announce(message, 'assertive');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
      }
    },
    [ai, announce, memory, messages, photo, settings, voice, task, localReply, addLocalReply, speakReply],
  );

  const cancelRequest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    announce('Request cancelled.');
  };

  const saveMemory = async () => {
    const proposal = pendingMemory;
    setPendingMemory(null);
    if (!proposal) return;
    try {
      await memory.create(proposal.input);
      if (proposal.responseLength) updateSettings({ responseLength: proposal.responseLength });
      setMemoryNotice({ ok: true, text: `${proposal.savedReply} "${proposal.input.text}"` });
      announce(`Memory saved. ${proposal.savedReply}`);
      speakReply(proposal.savedReply);
    } catch {
      setMemoryNotice({ ok: false, text: 'The memory could not be saved. Please try again.' });
      announce('The memory could not be saved.', 'assertive');
    }
  };

  const runTaskCommand = async (command: Parameters<typeof task.command>[0]) => {
    const text = await task.command(command);
    if (text) addLocalReply(text, 'task');
  };

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
    setMemoryNotice(null);
    setPending(false);
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

      {aiStatus.available ? (
        <Notice variant="info" title="About answers">
          Answers come from Meta AI (Muse Spark) through the OpenEyes server and can be wrong. OpenEyes only sees your
          surroundings when you attach a photo. Say &ldquo;Remember that...&rdquo; to save a note to My Memories after
          you confirm it.
        </Notice>
      ) : (
        <Notice variant="warning" title="AI answers not available yet">
          OpenEyes is not connected to Meta AI in this version of the app, so it cannot reply. Your messages stay on this
          device. Voice input and the controls on this screen work today.
        </Notice>
      )}

      {aiStatus.available && <PhotoAttachment photo={photo} onPhotoChange={setPhoto} />}

      {task.session && (
        <TaskPanel session={task.session} onCommand={(c) => void runTaskCommand(c)} onClose={task.clear} />
      )}

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
                  <p className="mt-1 text-xs opacity-70">
                    {formatDateTime(m.createdAt)}
                    {m.photoAttached ? ' · with photo' : ''}
                    {m.source === 'memory' ? ' · from your saved memories, not the camera' : ''}
                    {m.source === 'task' ? ' · guided task' : ''}
                    {m.memoriesShared
                      ? ` · ${m.memoriesShared} saved ${m.memoriesShared === 1 ? 'memory' : 'memories'} shared as background`
                      : ''}
                  </p>
                </div>
              </li>
            ))}
            <li ref={listEndRef} aria-hidden="true" />
          </ol>
        )}

        {pending && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="flex items-center gap-2 text-muted">
              <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" /> Waiting for OpenEyes
            </p>
            <button type="button" className="btn-secondary" onClick={cancelRequest}>
              <X aria-hidden="true" className="h-5 w-5" /> Cancel
            </button>
          </div>
        )}
        {memoryNotice && (
          <div className="mt-3">
            <Notice variant={memoryNotice.ok ? 'success' : 'error'} title={memoryNotice.ok ? 'Memory saved' : 'Not saved'}>
              {memoryNotice.text}
            </Notice>
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

      <ConfirmDialog
        open={pendingMemory !== null}
        title="Save this memory?"
        message={`${pendingMemory?.confirmPrompt ?? ''} "${pendingMemory?.input.text ?? ''}" will be saved in My Memories on this device. You can edit or delete it later.`}
        confirmLabel="Save memory"
        onConfirm={() => void saveMemory()}
        onCancel={() => {
          setPendingMemory(null);
          announce('Memory not saved.');
        }}
      />
    </>
  );
}
