import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';
import { resolveAppVersion, resolveBuildSha } from "./scripts/buildMetadata";

/**
 * Firebase emulator mode (NUT-13A) is for the local dev server only. A bundle
 * that could be deployed never carries it, whatever the env files or CI say.
 */
const refuseEmulatorBuild = (): Plugin => ({
  name: "fitssai-refuse-emulator-build",
  apply: "build",
  configResolved(config) {
    const flag = config.env.VITE_FIREBASE_USE_EMULATORS;
    if (flag !== undefined && flag !== "" && flag !== "false") {
      throw new Error("VITE_FIREBASE_USE_EMULATORS is set: emulator mode is refused for `vite build`.");
    }
  },
});

export default defineConfig(({ mode }) => ({
  define: {
    __FITSSAI_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
    // Anchored on the config's own directory: Vite bundles this file to a
    // temporary location, so a cwd- or import-relative lookup would not be
    // the same file in every build.
    __FITSSAI_APP_VERSION__: JSON.stringify(resolveAppVersion(__dirname)),
  },
  base: "/fitssai-coach/",
  server: {
    host: "::",
    port: 8080,
    // The E2E harness writes Playwright traces (HTML) under e2e/results.local;
    // watching them would reload the page under test mid-scenario.
    ...(mode === "e2e" ? { watch: { ignored: ["**/e2e/results.local/**"] } } : {}),
  },
  plugins: [
    refuseEmulatorBuild(),
    react(),
    // The single service-worker and manifest authority. Both are generated
    // from this config, and `base` is applied to start_url, scope and the
    // registration, so everything resolves under /fitssai-coach/.
    VitePWA({
      registerType: 'autoUpdate',
      // Registration lives in src/lib/pwa.ts so there is exactly one place
      // that registers a worker; the auto-injected script would be a second.
      injectRegister: null,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'FitssAI',
        short_name: 'FitssAI',
        description: 'Dein KI-Coach für Training & Ernährung.',
        lang: 'de',
        // Matches the theme-color meta tag in index.html.
        theme_color: '#16a34a',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          {
            src: 'icons/fitssai-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/fitssai-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/fitssai-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Cache standard assets for offline usage
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Drop precaches from previous deploys instead of accumulating them.
        cleanupOutdatedCaches: true,
        // index.html is precached with a content revision, so a new deploy
        // replaces the shell rather than pinning the old one forever.
        navigateFallback: 'index.html'
      }
    })
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-accordion', '@radix-ui/react-alert-dialog', '@radix-ui/react-aspect-ratio', '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-collapsible', '@radix-ui/react-context-menu', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-hover-card', '@radix-ui/react-label', '@radix-ui/react-menubar', '@radix-ui/react-navigation-menu', '@radix-ui/react-popover', '@radix-ui/react-progress', '@radix-ui/react-radio-group', '@radix-ui/react-scroll-area', '@radix-ui/react-select', '@radix-ui/react-separator', '@radix-ui/react-slider', '@radix-ui/react-slot', '@radix-ui/react-switch', '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-toggle', '@radix-ui/react-toggle-group', '@radix-ui/react-tooltip', 'class-variance-authority', 'clsx', 'tailwind-merge', 'lucide-react'],
          'framer-motion': ['framer-motion'],
          'utils': ['date-fns', 'date-fns-tz']
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Contract shared verbatim with the Functions backend — see shared/.
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));
