import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveExploreController, LIVE_EXPLORE_LIMITS, type LiveExploreDeps } from '../services/explore/liveExploreController';
import { assessChange, similarity } from '../services/explore/descriptionManager';
import { parseExploreCommand } from '../services/explore/exploreCommands';
import { AIRequestError } from '../types/ai';
import type { CapturedImage } from '../types/camera';

let frameCount = 0;
const frame = (): CapturedImage => ({
  blob: new Blob([`frame-${++frameCount}`], { type: 'image/jpeg' }),
  previewUrl: `blob:frame-${frameCount}`,
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone',
});

function setup(overrides: Partial<LiveExploreDeps> = {}, config: Partial<Parameters<typeof createLiveExploreController>[1]> = {}) {
  const deps = {
    captureFrame: vi.fn(async () => frame()),
    describe: vi.fn(async () => 'A desk with a laptop.'),
    releaseImage: vi.fn(),
    onObservation: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  };
  const controller = createLiveExploreController(deps, {
    mode: 'continuous',
    intervalMs: 8000,
    maxDurationMs: 10 * 60_000,
    ...config,
  });
  return { deps, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('live explore controller', () => {
  it('captures the first frame right away and the next one only after the interval', async () => {
    const { deps, controller } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    expect(deps.onObservation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7999);
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.captureFrame).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('never runs faster than the minimum interval', async () => {
    const { deps, controller } = setup({}, { intervalMs: 1000 });
    controller.start();
    await vi.advanceTimersByTimeAsync(LIVE_EXPLORE_LIMITS.minIntervalMs - 1);
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('never overlaps requests when Meta AI is slow', async () => {
    let resolve: (text: string) => void = () => undefined;
    const describe = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(describe).toHaveBeenCalledTimes(1);
    resolve('A hallway.');
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onObservation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(describe).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('sends nothing while paused and continues on resume', async () => {
    const { deps, controller } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    controller.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.captureFrame).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('cancels the request in flight and frees frames on stop', async () => {
    let signal: AbortSignal | undefined;
    const describe = vi.fn((_: CapturedImage, s: AbortSignal) => {
      signal = s;
      return new Promise<string>(() => undefined);
    });
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    expect(signal?.aborted).toBe(true);
    expect(deps.onEnd).toHaveBeenCalledWith('user');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(describe).toHaveBeenCalledTimes(1);
    expect(deps.onObservation).not.toHaveBeenCalled();
  });

  it('only analyzes on request in Ask only mode', async () => {
    const { deps, controller } = setup({}, { mode: 'ask' });
    controller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.captureFrame).not.toHaveBeenCalled();
    await controller.describeNow();
    expect(deps.onObservation).toHaveBeenCalledWith(expect.objectContaining({ source: 'requested' }), expect.objectContaining({ speak: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('marks repeated similar descriptions as not worth speaking', async () => {
    const { deps, controller } = setup({}, { mode: 'smart' });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8000);
    const calls = vi.mocked(deps.onObservation).mock.calls;
    expect(calls[0][1].speak).toBe(true);
    expect(calls[1][1].speak).toBe(false);
    controller.stop();
  });

  it('keeps a bounded history and frees older frames', async () => {
    const { deps, controller } = setup();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(8000);
    expect(controller.history).toHaveLength(LIVE_EXPLORE_LIMITS.historySize);
    expect(deps.releaseImage).toHaveBeenCalledTimes(2);
    controller.stop();
    expect(deps.releaseImage).toHaveBeenCalledTimes(7);
  });

  it('waits for the rate limit before trying again', async () => {
    const describe = vi
      .fn()
      .mockRejectedValueOnce(new AIRequestError('rate-limited', 'Busy.', 30))
      .mockResolvedValue('A kitchen.');
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onError).toHaveBeenCalledWith(expect.any(AIRequestError), true);
    expect(controller.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(describe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(describe).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe('live');
    controller.stop();
  });

  it('stops after repeated network failures', async () => {
    const describe = vi.fn().mockRejectedValue(new AIRequestError('network', 'Offline.'));
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(describe).toHaveBeenCalledTimes(3);
    expect(deps.onEnd).toHaveBeenCalledWith('error');
    expect(controller.status).toBe('ended');
  });

  it('stops immediately on errors that will not fix themselves', async () => {
    const describe = vi.fn().mockRejectedValue(new AIRequestError('not-configured', 'Not set up.'));
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onError).toHaveBeenCalledWith(expect.any(AIRequestError), false);
    expect(deps.onEnd).toHaveBeenCalledWith('error');
  });

  it('ends the session at the frame limit', async () => {
    const { deps, controller } = setup({}, { maxFrames: 2 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(deps.captureFrame).toHaveBeenCalledTimes(2);
    expect(deps.onEnd).toHaveBeenCalledWith('session-limit');
  });

  it('ends the session at the time limit', async () => {
    const { deps, controller } = setup({}, { maxDurationMs: 20_000 });
    controller.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.onEnd).toHaveBeenCalledWith('session-limit');
  });

  it('gives user requests priority over automatic descriptions', async () => {
    let autoSignal: AbortSignal | undefined;
    const describe = vi.fn((_: CapturedImage, s: AbortSignal) => {
      autoSignal = s;
      return new Promise<string>(() => undefined);
    });
    const { deps, controller } = setup({ describe });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const answer = controller.runExclusive(async () => 'answer');
    expect(autoSignal?.aborted).toBe(true);
    await expect(answer).resolves.toBe('answer');
    expect(deps.onObservation).not.toHaveBeenCalled();
    controller.stop();
  });
});

describe('description manager', () => {
  it('scores reworded descriptions of the same scene as similar', () => {
    expect(similarity('A desk with a laptop and a mug.', 'There is a laptop and a mug on the desk.')).toBeGreaterThan(0.5);
    expect(similarity('A desk with a laptop.', 'A front door with a doormat.')).toBeLessThan(0.2);
  });

  it('speaks the first description, new scenes and newly visible people', () => {
    expect(assessChange('A kitchen counter.', [])).toEqual({ speak: true, reason: 'first' });
    expect(assessChange('A kitchen counter with a kettle.', ['A kitchen counter with a kettle.']).speak).toBe(false);
    expect(assessChange('A garden with a bench.', ['A kitchen counter with a kettle.']).speak).toBe(true);
    expect(assessChange('A kitchen counter with a kettle and a person.', ['A kitchen counter with a kettle.'])).toEqual({
      speak: true,
      reason: 'new-attention-object',
    });
  });
});

describe('explore command routing', () => {
  it.each([
    ['Stop', 'stop'],
    ['Pause', 'pause'],
    ['Keep exploring', 'resume'],
    ['Describe that again', 'repeat'],
    ['Read that sign', 'read'],
    ['Remember this', 'remember'],
    ['OpenEyes, explore what’s around me.', 'start'],
  ])('"%s" is %s', (input, type) => {
    expect(parseExploreCommand(input)?.type).toBe(type);
  });

  it('extracts the object to find', () => {
    expect(parseExploreCommand('Find my keys')).toEqual({ type: 'find', object: 'keys' });
  });

  it('treats view questions as questions about the current frame', () => {
    expect(parseExploreCommand("What's on my left?")).toEqual({ type: 'ask', question: "What's on my left?", about: 'current' });
    expect(parseExploreCommand("What's in front of me?")).toMatchObject({ type: 'ask', about: 'current' });
  });

  it('treats past-tense questions as questions about earlier frames', () => {
    expect(parseExploreCommand('What color was the cup?')).toMatchObject({ type: 'ask', about: 'previous' });
  });

  it('ignores empty input', () => {
    expect(parseExploreCommand('   ')).toBeNull();
  });
});
