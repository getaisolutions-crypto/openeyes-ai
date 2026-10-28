import type { SpeechErrorKind } from '../../types/voice';

export const PCM_TARGET_RATE = 16_000;
/** 80 ms at 16 kHz, the frame size used in Meta's realtime example. */
export const PCM_FRAME_SAMPLES = 1280;

/**
 * Resamples Float32 audio to 16 kHz and emits signed 16-bit little-endian mono frames of a fixed size.
 * Linear interpolation is enough for speech recognition and keeps the CPU cost low on phones.
 */
export function createPcm16Framer(
  inputRate: number,
  onFrame: (frame: ArrayBuffer) => void,
  outputRate = PCM_TARGET_RATE,
  frameSamples = PCM_FRAME_SAMPLES,
) {
  const step = inputRate / outputRate;
  let position = 0;
  let previous = 0;
  let frame = new Int16Array(frameSamples);
  let filled = 0;

  return (input: Float32Array) => {
    if (!input.length) return;
    // position is relative to input[0]; -1 refers to the last sample of the previous chunk.
    for (;;) {
      const i = Math.floor(position);
      if (i + 1 >= input.length) break;
      const frac = position - i;
      const a = i < 0 ? previous : input[i];
      const b = input[i + 1];
      const v = Math.max(-1, Math.min(1, a + (b - a) * frac));
      frame[filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (filled === frameSamples) {
        onFrame(frame.buffer);
        frame = new Int16Array(frameSamples);
        filled = 0;
      }
      position += step;
    }
    position -= input.length;
    previous = input[input.length - 1];
  };
}

export interface PcmCapture {
  /** Stops the microphone tracks and audio processing. Safe to call more than once. */
  stop(): void;
}

const WORKLET_SOURCE = `
class OpenEyesCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('openeyes-capture', OpenEyesCapture);
`;

function mapMediaError(error: unknown): SpeechErrorKind {
  const name = error instanceof DOMException ? error.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'permission-denied' : 'audio-capture';
}

export function isPcmCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) === 'function'
  );
}

/** Captures microphone audio as 16 kHz PCM frames. Rejects with a SpeechErrorKind. Nothing is recorded or stored. */
export async function startPcmCapture(onFrame: (frame: ArrayBuffer) => void): Promise<PcmCapture> {
  if (!isPcmCaptureSupported()) throw 'unsupported' as SpeechErrorKind;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    throw mapMediaError(error);
  }

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let context: AudioContext | null = null;
  let stopped = false;
  let workletUrl: string | null = null;
  const nodes: AudioNode[] = [];

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    nodes.forEach((node) => node.disconnect());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    void context?.close().catch(() => undefined);
  };

  try {
    context = new Ctor();
    if (context.state === 'suspended') await context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    nodes.push(source);
    const push = createPcm16Framer(context.sampleRate, (frame) => {
      if (!stopped) onFrame(frame);
    });

    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, 'openeyes-capture');
      node.port.onmessage = (event: MessageEvent<Float32Array>) => push(event.data);
      source.connect(node);
      nodes.push(node);
    } else {
      const processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => push(event.inputBuffer.getChannelData(0));
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      nodes.push(processor, mute);
    }
  } catch {
    stop();
    throw 'audio-capture' as SpeechErrorKind;
  }
  if (stopped) throw 'aborted' as SpeechErrorKind;
  return { stop };
}
