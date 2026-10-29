import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import {
  applyTaskCommand,
  offerTask,
  parseTaskCommand,
  parseTaskRequest,
  phraseTaskState,
  withPlan,
} from '../services/tasks/taskSession';
import { STORAGE_KEYS } from '../utils/storage';

beforeEach(() => localStorage.clear());

const STEPS = ['Fill the kettle with water.', 'Put one spoon of coffee in the cup.', 'Pour the hot water into the cup.'];

function setup(post: OpenEyesBackend['post'] = async () => ({ plan: { steps: STEPS } })) {
  const backend: OpenEyesBackend = { post: vi.fn(post), health: vi.fn(async () => ({ configured: true })) };
  const services = createTestServices(createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'));
  return { services, backend };
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText('Type a message'), text);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

const messages = () => screen.getByRole('list', { name: 'Messages' });
const panel = () => screen.getByRole('region', { name: /Guided task/ });

describe('task session engine', () => {
  it('never advances without a command and tracks completed steps', () => {
    let s = withPlan(applyTaskCommand(offerTask('t1', 'make coffee'), 'start'), STEPS);
    expect(s).toMatchObject({ status: 'active', current: 0, completed: [], awaitingConfirmation: true });
    s = applyTaskCommand(s, 'repeat');
    expect(s.current).toBe(0);
    s = applyTaskCommand(s, 'next');
    expect(s).toMatchObject({ current: 1, completed: [0] });
    s = applyTaskCommand(s, 'back');
    expect(s).toMatchObject({ current: 0, completed: [] });
    s = applyTaskCommand(applyTaskCommand(s, 'pause'), 'next');
    expect(s).toMatchObject({ status: 'paused', current: 0 });
    s = applyTaskCommand(s, 'resume');
    s = applyTaskCommand(applyTaskCommand(applyTaskCommand(s, 'next'), 'next'), 'next');
    expect(s.status).toBe('done');
    expect(phraseTaskState(s, 'next')).toMatch(/last step/);
  });

  it('parses commands and requests', () => {
    expect(parseTaskCommand('Next step.')).toBe('next');
    expect(parseTaskCommand('Repeat that')).toBe('repeat');
    expect(parseTaskCommand('Go back')).toBe('back');
    expect(parseTaskCommand('Stop')).toBe('stop');
    expect(parseTaskCommand('What is the weather?')).toBeNull();
    expect(parseTaskRequest('Help me make coffee.')).toBe('make coffee');
    expect(parseTaskRequest('Walk me through setting the oven timer')).toBe('setting the oven timer');
  });

  it('treats an empty plan as not started instead of inventing steps', () => {
    const s = withPlan(applyTaskCommand(offerTask('t1', 'cross the road'), 'start'), []);
    expect(s.status).toBe('stopped');
    expect(phraseTaskState(s, 'planned')).toMatch(/couldn't put together steps/);
  });
});

describe('guided tasks in the assistant', () => {
  it('offers first, plans only after yes, and moves step by step on request', async () => {
    const user = userEvent.setup();
    const { services, backend } = setup();
    renderApp('/assistant', services);
    await say(user, 'Help me make coffee');
    expect(await within(messages()).findByText('I can guide you through the steps to make coffee. Would you like to start?')).toBeInTheDocument();
    expect(backend.post).not.toHaveBeenCalled();

    await say(user, 'Yes');
    expect(await within(messages()).findByText(/Step 1 of 3: Fill the kettle/)).toBeInTheDocument();
    expect(vi.mocked(backend.post).mock.calls[0][0]).toMatchObject({ task: 'task_plan', taskName: 'make coffee' });

    await say(user, 'Next step');
    expect(await within(messages()).findByText(/Step 2 of 3: Put one spoon/)).toBeInTheDocument();
    await say(user, 'Go back');
    expect((await within(messages()).findAllByText(/Step 1 of 3/)).length).toBeGreaterThanOrEqual(2);
    await user.click(within(panel()).getByRole('button', { name: 'Repeat step' }));
    expect(within(messages()).getAllByText(/Step 1 of 3/).length).toBeGreaterThanOrEqual(3);
    await say(user, 'Stop');
    expect(await within(messages()).findByText('Task stopped.')).toBeInTheDocument();
    expect(backend.post).toHaveBeenCalledTimes(1);
  });

  it('keeps a paused task on this device and resumes it', async () => {
    const user = userEvent.setup();
    const { services } = setup();
    const { unmount } = renderApp('/assistant', services);
    await say(user, 'Help me make coffee');
    await user.click(await within(panel()).findByRole('button', { name: 'Start task' }));
    await within(panel()).findByRole('button', { name: 'Next step' });
    await user.click(within(panel()).getByRole('button', { name: 'Pause task' }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEYS.pausedTask)).toContain('make coffee'));
    unmount();

    renderApp('/assistant', services);
    await user.click(await within(await screen.findByRole('region', { name: /Guided task/ })).findByRole('button', { name: 'Resume task' }));
    expect(await within(panel()).findByRole('button', { name: 'Next step' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.pausedTask)).toBeNull();
  });

  it('recovers when the plan request fails', async () => {
    const user = userEvent.setup();
    const { services } = setup(async () => {
      throw new Error('network down');
    });
    renderApp('/assistant', services);
    await say(user, 'Help me make coffee');
    await say(user, 'Yes');
    expect(await within(messages()).findByText(/The task was not started/)).toBeInTheDocument();
    await say(user, 'Hello');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  });
});
