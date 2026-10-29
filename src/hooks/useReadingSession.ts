import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useReloadParticipant } from './useAppUpdate';
import { aiErrorMessage } from './useAIRequest';
import type { DocumentAnswer, QuickReadResult } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import { BASIS_LABEL, parseReadFollowUp, phraseDocumentAnswer, readParagraph } from '../services/read/readingSession';
import { LIMITS } from '../utils/validation';

export interface ReadingTurn {
  id: number;
  question: string;
  /** What OpenEyes says, already labelled as exact text, summary, inference or not found. */
  reply: string;
  label: string;
  quote?: string;
}

/**
 * Holds one captured document in memory only. Nothing here is written to storage, and
 * clearing the session (or leaving the page) drops the photo, the text and the answers.
 */
export function useReadingSession(image: CapturedImage | null, fullText: string) {
  const { vision } = useServices();
  const [quick, setQuick] = useState<QuickReadResult | null>(null);
  const [turns, setTurns] = useState<ReadingTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAsking(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setQuick(null);
    setTurns([]);
    setError(null);
  }, [cancel]);

  useEffect(() => reset(), [image, reset]);
  useEffect(() => cancel, [cancel]);
  useReloadParticipant('Reading session', asking, cancel);

  const addTurn = (turn: Omit<ReadingTurn, 'id'>) => {
    const full = { ...turn, id: nextId.current++ };
    setTurns((prev) => [...prev, full].slice(-20));
    return full;
  };

  /** Returns the spoken reply, or null when nothing could be answered. */
  const ask = useCallback(
    async (rawQuestion: string): Promise<string | null> => {
      const question = rawQuestion.trim().slice(0, 300);
      if (!question) return null;
      setError(null);
      const followUp = parseReadFollowUp(question);
      const sourceText = fullText.trim() || quick?.keyText || '';
      if (followUp.kind === 'again') {
        const reply = sourceText || 'There is no text to read again yet.';
        return addTurn({ question, reply, label: 'Exact text' }).reply;
      }
      if (followUp.kind === 'paragraph') {
        const reply = fullText.trim()
          ? readParagraph(fullText, followUp.index)
          : 'Use Full read first so I have the whole text in order.';
        return addTurn({ question, reply, label: fullText.trim() ? 'Exact text' : 'Not available yet' }).reply;
      }
      if (!image) {
        setError('Take or choose a photo of the text first.');
        return null;
      }
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;
      setAsking(true);
      try {
        const answer: DocumentAnswer = await vision.askAboutText(image, question, { signal: controller.signal });
        if (controller.signal.aborted) return null;
        return addTurn({
          question,
          reply: phraseDocumentAnswer(answer),
          label: BASIS_LABEL[answer.basis],
          quote: answer.quote ? answer.quote.slice(0, LIMITS.readText) : undefined,
        }).reply;
      } catch (e) {
        if (controller.signal.aborted) return null;
        setError(aiErrorMessage(e));
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setAsking(false);
      }
    },
    [cancel, fullText, image, quick, vision],
  );

  return { quick, setQuick, turns, ask, asking, error, cancel, reset };
}
