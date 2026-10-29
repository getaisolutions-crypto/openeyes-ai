import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from './useCamera';
import { useReloadParticipant } from './useAppUpdate';
import { useSpeechSynthesis } from './useSpeechSynthesis';
import { useSettings } from './useSettings';
import { useAnnouncer } from './useAnnouncer';
import { useServices } from '../services/ServicesContext';
import { aiErrorMessage } from './useAIRequest';
import type { ObjectDetectionResult } from '../types/ai';
import {
  MAX_SCANS_PER_ROUND,
  SCAN_INTERVAL_MS,
  isConfidentMatch,
  phraseSearchResult,
  startPhrase,
  yourItem,
} from '../services/find/objectSearch';

export type SearchStatus = 'idle' | 'starting' | 'analyzing' | 'waiting' | 'found' | 'paused' | 'error';

/**
 * One interactive search: live camera, one frame analysed at a time, a fixed pause between frames,
 * and a cap per round. Frames are never stored; each is released once analysed.
 */
export function useObjectSearch(item: string) {
  const { objectDetection } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const tts = useSpeechSynthesis();
  const cam = useCamera();
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [lastResult, setLastResult] = useState<ObjectDetectionResult | null>(null);
  const [message, setMessage] = useState('');
  const [scans, setScans] = useState(0);

  const activeRef = useRef(false);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundScansRef = useRef(0);
  const totalScansRef = useRef(0);
  const itemRef = useRef(item);
  itemRef.current = item;

  const say = useCallback(
    (text: string) => {
      setMessage(text);
      announce(text);
      if (settings.voiceOutput) tts.speak(text);
    },
    [announce, settings.voiceOutput, tts],
  );

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const halt = useCallback(() => {
    activeRef.current = false;
    clearTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
  }, []);

  const scanOnce = useCallback(async () => {
    if (!activeRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('analyzing');
    const controller = new AbortController();
    abortRef.current = controller;
    let frameUrl: string | null = null;
    try {
      const frame = await cam.captureFrame();
      if (!frame) throw new Error('no-frame');
      frameUrl = frame.previewUrl;
      const result = await objectDetection.findObject(itemRef.current, frame, { signal: controller.signal });
      if (!activeRef.current || controller.signal.aborted) return;
      const index = totalScansRef.current;
      totalScansRef.current += 1;
      roundScansRef.current += 1;
      setScans(totalScansRef.current);
      setLastResult(result);
      say(phraseSearchResult(result, index));
      if (isConfidentMatch(result)) {
        halt();
        setStatus('found');
        return;
      }
      if (roundScansRef.current >= MAX_SCANS_PER_ROUND) {
        halt();
        setStatus('paused');
        say(`I paused the search to save data. Say keep looking or press Keep looking to continue.`);
        return;
      }
      setStatus('waiting');
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void scanOnce();
      }, SCAN_INTERVAL_MS);
    } catch (error) {
      if (controller.signal.aborted || !activeRef.current) return;
      halt();
      setStatus('error');
      say(
        error instanceof Error && error.message === 'no-frame'
          ? 'The camera is not ready. Start the search again.'
          : `The search stopped. ${aiErrorMessage(error)}`,
      );
    } finally {
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
    }
  }, [cam, halt, objectDetection, say]);

  const begin = useCallback(async () => {
    if (!itemRef.current.trim()) return;
    halt();
    setLastResult(null);
    roundScansRef.current = 0;
    totalScansRef.current = 0;
    setScans(0);
    setStatus('starting');
    say(startPhrase(itemRef.current));
    await cam.start();
  }, [cam, halt, say]);

  // Start analysing once the camera is live, or report a camera problem.
  useEffect(() => {
    if (status !== 'starting') return;
    if (cam.status === 'live') {
      activeRef.current = true;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void scanOnce();
      }, 1500);
    } else if (cam.status === 'error') {
      setStatus('error');
    }
  }, [cam.status, status, scanOnce]);

  const keepLooking = useCallback(() => {
    if (cam.status !== 'live') {
      void begin();
      return;
    }
    halt();
    roundScansRef.current = 0;
    activeRef.current = true;
    say(`Still looking for ${yourItem(itemRef.current)}. Move your camera slowly.`);
    setStatus('waiting');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void scanOnce();
    }, SCAN_INTERVAL_MS / 2);
  }, [begin, cam.status, halt, say, scanOnce]);

  const end = useCallback(
    (spoken = true) => {
      const wasRunning = status !== 'idle';
      halt();
      cam.discard();
      setStatus('idle');
      if (spoken && wasRunning) say('Search stopped. The camera is off.');
    },
    [cam, halt, say, status],
  );

  useEffect(() => halt, [halt]);

  const busy = status === 'starting' || status === 'analyzing' || status === 'waiting';
  useReloadParticipant('Object search', busy, () => end(false));

  return {
    videoRef: cam.videoRef,
    cameraStatus: cam.status,
    cameraError: cam.errorKind,
    status,
    lastResult,
    message,
    scans,
    begin,
    keepLooking,
    end,
  };
}
