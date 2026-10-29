/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

const BUILD_INFO = {
  version: pkg.version,
  buildId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  builtAt: new Date().toISOString(),
};

/** Embeds the build identity in the app and publishes the same identity as /version.json for update checks. */
function buildInfo(): Plugin {
  const body = JSON.stringify(BUILD_INFO);
  return {
    name: 'openeyes-build-info',
    config: () => ({ define: { __APP_BUILD__: body } }),
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body });
    },
  };
}

export default defineConfig({
  plugins: [react(), buildInfo()],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Full-page axe scans of lazy-loaded screens can exceed 5s when every test file runs in parallel.
    testTimeout: 15000,
  },
});
