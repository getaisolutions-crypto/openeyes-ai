import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Lazy-loaded routes compile on first import in tests, which can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

// Server-function tests run in the node environment, where there is no DOM to reset.
const hasDom = typeof window !== 'undefined';

beforeEach(() => {
  if (!hasDom) return;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-text-size');
});

afterEach(() => {
  if (hasDom) cleanup();
});

if (hasDom && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}
