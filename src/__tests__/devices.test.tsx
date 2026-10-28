import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/utils';
import { createMetaGlassesDevice } from '../services/devices/metaGlassesDevice';

describe('meta glasses device provider', () => {
  it('reports not connected and refuses to fake a connection', async () => {
    const device = createMetaGlassesDevice();
    expect((await device.getInfo()).state).toBe('not-connected');
    const result = await device.connect!();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('native-integration-unavailable');
  });
});

describe('devices screen', () => {
  it('shows Meta Glasses as Not Connected on Home', async () => {
    renderApp('/');
    const status = await screen.findByRole('region', { name: 'Device status' });
    const row = (await within(status).findByText('Meta Glasses')).closest('li')!;
    expect(await within(row).findByText('Not Connected')).toBeInTheDocument();
  });

  it('reports phone camera and microphone unavailable without media APIs', async () => {
    renderApp('/devices');
    const cameraHeading = await screen.findByRole('heading', { name: 'Phone Camera' });
    const card = cameraHeading.closest('li')!;
    expect(await within(card).findByText('Unavailable')).toBeInTheDocument();
  });

  it('explains that glasses cannot connect yet and stays Not Connected', async () => {
    const user = userEvent.setup();
    renderApp('/devices');
    await user.click(await screen.findByRole('button', { name: 'Connect Meta Glasses' }));
    const dialog = await screen.findByRole('dialog', { name: 'Meta glasses not available yet' });
    expect(dialog).toHaveTextContent('Meta Wearables Device Access Toolkit');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    const card = screen.getByRole('heading', { name: 'Meta Glasses' }).closest('li')!;
    expect(within(card).getByText('Not Connected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('does not allow selecting the glasses camera source', async () => {
    renderApp('/devices');
    expect(await screen.findByRole('radio', { name: /Meta glasses camera/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Phone camera/ })).toBeChecked();
  });
});
