import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import type { CapturedImage } from '../types/camera';
import { parseReadFollowUp, phraseDocumentAnswer, phraseQuickRead, readParagraph, splitParagraphs } from '../services/read/readingSession';
import { STORAGE_KEYS } from '../utils/storage';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});
beforeEach(() => localStorage.clear());

const photo: CapturedImage = {
  blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
  previewUrl: 'blob:doc',
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone',
};

const LETTER = 'Acme Insurance\n\nDear customer, your policy renews soon.\n\nPlease reply by November 15.';

function setup(post: OpenEyesBackend['post']) {
  const backend: OpenEyesBackend = { post: vi.fn(post), health: vi.fn(async () => ({ configured: true })) };
  const services = createTestServices({
    ...createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'),
    camera: createFakeCamera({ capture: vi.fn(async () => photo) }),
  });
  return { services, backend };
}

async function takePhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
  await user.click(await screen.findByRole('button', { name: 'Capture photo' }));
}

describe('reading session logic', () => {
  it('recognises local follow-ups and leaves other questions for the AI', () => {
    expect(parseReadFollowUp('Read the second paragraph.')).toEqual({ kind: 'paragraph', index: 2 });
    expect(parseReadFollowUp('read paragraph 3')).toEqual({ kind: 'paragraph', index: 3 });
    expect(parseReadFollowUp('Read the last paragraph')).toEqual({ kind: 'paragraph', index: 'last' });
    expect(parseReadFollowUp('Read it again')).toEqual({ kind: 'again' });
    expect(parseReadFollowUp("What's the deadline?")).toEqual({ kind: 'question', text: "What's the deadline?" });
  });

  it('reads paragraphs exactly as extracted and never invents missing ones', () => {
    expect(splitParagraphs(LETTER)).toHaveLength(3);
    expect(readParagraph(LETTER, 2)).toBe('Dear customer, your policy renews soon.');
    expect(readParagraph(LETTER, 7)).toBe('I only found 3 paragraphs in the text.');
  });

  it('labels answers as exact text, summary, inference or not found', () => {
    const base = { modelId: 'muse-spark' as const, quote: '' };
    expect(phraseDocumentAnswer({ ...base, answer: 'The letter states November 15.', basis: 'exact', quote: 'reply by November 15' })).toBe(
      'The letter states November 15. The text says: reply by November 15',
    );
    expect(phraseDocumentAnswer({ ...base, answer: 'A renewal notice.', basis: 'summary' })).toMatch(/^In summary:/);
    expect(phraseDocumentAnswer({ ...base, answer: 'Probably yearly.', basis: 'inference' })).toMatch(/^This is my inference/);
    expect(phraseDocumentAnswer({ ...base, answer: 'No phone number.', basis: 'not-found' })).toMatch(/^I couldn't find that/);
  });

  it('explains blurry photos instead of guessing', () => {
    expect(
      phraseQuickRead({ readable: false, documentType: 'unknown', keyText: '', summary: '', reason: 'The photo is blurry', modelId: 'muse-spark' }),
    ).toMatch(/^The photo is blurry\. I won't guess at the words/);
  });
});

describe('Read screen', () => {
  it('quick read keeps exact text separate from the AI summary', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => ({
      quickRead: { readable: true, documentType: 'letter', keyText: 'Acme Insurance\nReply by November 15', summary: 'A letter from your insurance company.' },
    }));
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Quick read' }));
    const card = await screen.findByRole('region', { name: 'Quick read' });
    expect(within(card).getByText('Exact text found').nextElementSibling).toHaveTextContent('Acme Insurance Reply by November 15');
    expect(within(card).getByText(/AI summary, not a quote/).nextElementSibling).toHaveTextContent('A letter from your insurance company.');
  });

  it('reports unreadable text without inventing words', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => ({
      quickRead: { readable: false, documentType: 'unknown', keyText: '', summary: '', reason: 'The photo is blurry.' },
    }));
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Quick read' }));
    expect(await screen.findByText('Text cannot be read reliably')).toBeInTheDocument();
  });

  it('answers follow-up questions about the same captured document', async () => {
    const user = userEvent.setup();
    const { services, backend } = setup(async (payload) => {
      const p = payload as Record<string, unknown>;
      if (p.task === 'read') return { readable: true, text: LETTER };
      return { answer: { answer: 'The letter states November 15.', basis: 'exact', quote: 'Please reply by November 15.' } };
    });
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Read text from photo' }));
    await screen.findByText('Text found');

    await user.type(screen.getByLabelText('Your question'), "What's the deadline?");
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const answers = await screen.findByRole('list', { name: 'Answers about this text' });
    expect(await within(answers).findByText(/The letter states November 15\. The text says: Please reply by November 15\./)).toBeInTheDocument();
    expect(within(answers).getByText('Stated in the text')).toBeInTheDocument();
    const askCall = (backend.post as ReturnType<typeof vi.fn>).mock.calls.find(([p]) => (p as { task: string }).task === 'ask_text');
    expect(askCall?.[0]).toMatchObject({ task: 'ask_text', question: "What's the deadline?" });

    await user.type(screen.getByLabelText('Your question'), 'Read the second paragraph');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await within(answers).findByText('Dear customer, your policy renews soon.')).toBeInTheDocument();
    expect(backend.post).toHaveBeenCalledTimes(2);
  });

  it('clears the reading session and never stores document text', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => ({ readable: true, text: LETTER }));
    renderApp('/read', services);
    await takePhoto(user);
    await user.click(screen.getByRole('button', { name: 'Read text from photo' }));
    await screen.findByText('Text found');
    const stored = Object.values(STORAGE_KEYS).map((k) => localStorage.getItem(k) ?? '').join('');
    expect(stored).not.toContain('November 15');
    await user.click(screen.getByRole('button', { name: 'Clear reading session' }));
    await waitFor(() => expect(screen.getByLabelText('Text')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Read text from photo' })).toBeDisabled();
    expect(screen.queryByText('Text found')).not.toBeInTheDocument();
  });
});
