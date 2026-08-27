import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
    Vite searches upward for a PostCSS config and finds the client's, then
    tries to load Tailwind out of the root install — which the backend CI job
    does not have. Server tests process no CSS at all, so the search is turned
    off rather than satisfied.
  */
  css: { postcss: { plugins: [] } },
  test: {
    // Server code. No jsdom, no browser globals — if something in here needs a
    // DOM, it is in the wrong workspace.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
