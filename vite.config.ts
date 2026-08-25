import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Commit being built. CI provides GITHUB_SHA; locally we ask Git. Falls back
 * to "unknown", which the app renders as "Build dev".
 */
const resolveBuildSha = (): string => {
  const fromCi = process.env.GITHUB_SHA || process.env.VITE_BUILD_SHA;
  if (fromCi && fromCi.trim() !== "") return fromCi.trim();
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
};

/** App version, read from package.json so it is never hand-maintained here. */
const resolveAppVersion = (): string => {
  try {
    const require = createRequire(import.meta.url);
    return require("./package.json").version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export default defineConfig(({ mode }) => ({
  define: {
    __FITSSAI_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
    __FITSSAI_APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  base: "/fitssai-coach/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
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
    },
  },
}));
