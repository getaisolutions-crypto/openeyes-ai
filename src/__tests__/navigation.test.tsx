import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/utils';

const ROUTES: [string, string][] = [
  ['/', 'OpenEyes AI'],
  ['/assistant', 'Assistant'],
  ['/explore', 'Explore'],
  ['/find', 'Find'],
  ['/read', 'Read'],
  ['/memory', 'Memory'],
  ['/devices', 'Devices'],
  ['/trusted-circle', 'Trusted Circle'],
  ['/settings', 'Settings'],
];

describe('navigation', () => {
  it.each(ROUTES)('renders %s with heading "%s"', async (route, heading) => {
    renderApp(route);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('shows home screen primary and secondary actions', async () => {
    renderApp('/');
    expect(await screen.findByText('Your World, Understood.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Talk to OpenEyes/ })).toHaveAttribute('href', '/assistant');
    const quick = screen.getByRole('navigation', { name: 'Quick actions' });
    for (const label of ['Describe My Surroundings', 'Find Something', 'Read Text', 'My Memories']) {
      expect(within(quick).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('navigates between sections and marks the current page', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'OpenEyes AI' });
    const [mainNav] = screen.getAllByRole('navigation', { name: 'Main' });
    await user.click(within(mainNav).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(within(mainNav).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('moves focus to the page heading after navigation', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Find Something' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Find' });
    expect(heading).toHaveFocus();
    expect(document.title).toBe('Find - OpenEyes AI');
  });

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});
