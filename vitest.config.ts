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
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
