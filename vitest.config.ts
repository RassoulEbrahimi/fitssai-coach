import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { createRequire } from 'module';

// Mirror the build-time injection from vite.config.ts so buildInfo is exercised
// with the same values production gets, instead of its no-injection fallback.
const require_ = createRequire(import.meta.url);
const appVersion: string = require_('./package.json').version ?? '0.0.0';

export default defineConfig({
  plugins: [react()],
  define: {
    __FITSSAI_APP_VERSION__: JSON.stringify(appVersion),
    __FITSSAI_BUILD_SHA__: JSON.stringify('unknown'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    /*
      The Functions workspace has its own vitest, its own node environment and
      its own dependency tree. Collecting it here would run server tests in
      jsdom and silently merge two suites that are meant to fail separately.
    */
    exclude: ['**/node_modules/**', '**/dist/**', 'functions/**', 'rules-tests/**'],
    css: false,
  },
  resolve: {
    alias: [
      /*
        Firebase initialises at module scope, so importing any component that
        reaches it throws auth/invalid-api-key without config and the test file
        fails during collection. Tests get an inert double instead — no
        credentials, no network. Must precede the generic '@' alias.
      */
      {
        find: /^@\/lib\/firebase$/,
        replacement: path.resolve(__dirname, './src/test/mocks/firebase.ts'),
      },
      { find: '@shared', replacement: path.resolve(__dirname, './shared') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
