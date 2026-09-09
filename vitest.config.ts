import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { resolveAppVersion } from './scripts/buildMetadata';

// Mirror the build-time injection from vite.config.ts so buildInfo is exercised
// with the same values production gets, instead of its no-injection fallback.
// Same resolver the build uses, so a missing or empty version fails here too
// rather than being papered over with a release-shaped placeholder.
const appVersion: string = resolveAppVersion(__dirname);

export default defineConfig({
  plugins: [react()],
  /*
    Same base the production build is served under (see vite.config.ts). Asset
    URLs built from import.meta.env.BASE_URL are then the URLs GitHub Pages
    actually serves, so a test can tell a base-aware path from a root-relative
    one instead of seeing "/" for both.
  */
  base: '/fitssai-coach/',
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
