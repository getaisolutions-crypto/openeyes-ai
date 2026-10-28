import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createTestServices, renderApp } from '../test/utils';
import { toCameraError } from '../services/camera/browserCameraProvider';
import { CameraError } from '../types/camera';

describe('camera error mapping', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['Weird', 'unknown'],
  ])('%s maps to %s', (name, kind) => {
    expect(toCameraError(new DOMException('x', name)).kind).toBe(kind);
  });
});

describe('camera permission handling', () => {
  it('does not request the camera until the user asks', async () => {
    const camera = createFakeCamera();
    renderApp('/explore', createTestServices({ camera }));
    await screen.findByRole('heading', { level: 1, name: 'Explore' });
    expect(camera.start).not.toHaveBeenCalled();
    expect(screen.getByText('Camera is off. Nothing is being recorded.')).toBeInTheDocument();
  });

  it('shows a permission denied state', async () => {
    const user = userEvent.setup();
    const camera = createFakeCamera({
      start: async () => {
        throw toCameraError(new DOMException('denied', 'NotAllowedError'));
      },
    });
    renderApp('/explore', createTestServices({ camera }));
    await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
    expect(await within(screen.getByRole('main')).findByText('Camera permission denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try camera again' })).toBeInTheDocument();
  });

  it('shows an unavailable state when the browser has no camera API', async () => {
    const user = userEvent.setup();
    const camera = createFakeCamera({ isSupported: () => false });
    renderApp('/read', createTestServices({ camera }));
    await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
    expect(await within(screen.getByRole('main')).findByText('Camera not supported')).toBeInTheDocument();
  });

  it('shows the live preview and capture controls when permission is granted', async () => {
    const user = userEvent.setup();
    renderApp('/explore');
    await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
    expect(await screen.findByRole('button', { name: 'Capture photo' })).toBeInTheDocument();
    expect(screen.getByText('Camera on')).toBeInTheDocument();
  });

  it('reports a capture failure honestly', async () => {
    const user = userEvent.setup();
    const camera = createFakeCamera({
      capture: async () => {
        throw new CameraError('unknown', 'not ready');
      },
    });
    renderApp('/explore', createTestServices({ camera }));
    await user.click(await screen.findByRole('button', { name: 'Turn on camera' }));
    await user.click(await screen.findByRole('button', { name: 'Capture photo' }));
    expect(await within(screen.getByRole('main')).findByText('Camera problem')).toBeInTheDocument();
  });

  it('keeps the describe action unavailable because vision is not connected', async () => {
    renderApp('/explore');
    expect(await screen.findByRole('button', { name: 'Describe my surroundings' })).toBeDisabled();
    expect(screen.getByText('Scene description not available yet')).toBeInTheDocument();
  });
});
