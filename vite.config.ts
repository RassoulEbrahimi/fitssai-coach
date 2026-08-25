import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
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

export default defineConfig(({ mode }) => ({
  define: {
    __FITSSAI_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  base: "/fitssai-coach/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'FitssAI Coach',
        short_name: 'FitssAI',
        description: 'Your AI-powered workout and nutrition coach.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'icons/fitssai-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/fitssai-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/fitssai-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Cache standard assets for offline usage
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
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
