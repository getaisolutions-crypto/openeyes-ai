import type { DocumentAnswer, QuickReadResult } from '../../types/ai';

export type ReadFollowUp =
  | { kind: 'paragraph'; index: number | 'last' }
  | { kind: 'again' }
  | { kind: 'question'; text: string };

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  '1st': 1,
  '2nd': 2,
  '3rd': 3,
  '4th': 4,
  '5th': 5,
};

/** Recognises requests that can be answered from the exact text without asking the AI again. */
export function parseReadFollowUp(raw: string): ReadFollowUp {
  const text = raw.trim().toLowerCase().replace(/[?.!]+$/, '');
  if (/^(read( it| that| this)? again|repeat( that| it)?|say (it|that) again)$/.test(text)) return { kind: 'again' };
  const ordinal = text.match(/\bread (?:me )?the (\w+) (?:paragraph|section|part)\b/);
  if (ordinal) {
    if (ordinal[1] === 'last') return { kind: 'paragraph', index: 'last' };
    const n = ORDINALS[ordinal[1]];
    if (n) return { kind: 'paragraph', index: n };
  }
  const numbered = text.match(/\bread (?:me )?paragraph (\d{1,2})\b/);
  if (numbered) return { kind: 'paragraph', index: Number(numbered[1]) };
  return { kind: 'question', text: raw.trim() };
}

/** Paragraphs are separated by blank lines; text without blank lines falls back to single lines. */
export function splitParagraphs(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function readParagraph(text: string, index: number | 'last'): string {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return 'There is no text to read yet.';
  const n = index === 'last' ? paragraphs.length : index;
  if (n < 1 || n > paragraphs.length) {
    return `I only found ${paragraphs.length} ${paragraphs.length === 1 ? 'paragraph' : 'paragraphs'} in the text.`;
  }
  return paragraphs[n - 1];
}

export const BASIS_LABEL: Record<DocumentAnswer['basis'], string> = {
  exact: 'Stated in the text',
  summary: 'Summary of the text',
  inference: 'Inference, not stated directly',
  'not-found': 'Not found in the text',
};

/** Spoken form of an answer, always saying what kind of answer it is. */
export function phraseDocumentAnswer(answer: DocumentAnswer): string {
  switch (answer.basis) {
    case 'exact':
      return answer.quote ? `${answer.answer} The text says: ${answer.quote}` : answer.answer;
    case 'summary':
      return `In summary: ${answer.answer}`;
    case 'inference':
      return `This is my inference, the text does not say it directly. ${answer.answer}`;
    case 'not-found':
      return `I couldn't find that in the text. ${answer.answer}`;
  }
}

export function phraseQuickRead(result: QuickReadResult): string {
  if (!result.readable) {
    const why = result.reason ? `${result.reason.replace(/\.$/, '')}.` : 'The text could not be read reliably.';
    return `${why} I won't guess at the words. Try more light, hold the phone steady, or move a little closer.`;
  }
  const type = result.documentType && result.documentType !== 'unknown' ? `This looks like a ${result.documentType}. ` : '';
  return `${type}The most important text says: ${result.keyText.replace(/\n+/g, '. ')}`;
}
