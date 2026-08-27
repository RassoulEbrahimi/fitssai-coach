import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
    Vite searches upward for a PostCSS config and would find the client's, then
    try to load Tailwind out of an install this workspace does not have. Rules
    tests process no CSS, so the search is turned off rather than satisfied.
  */
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    globals: true,
    include: ["*.test.ts"],
    /*
      One emulator, one rules file, shared state. Running files in parallel
      would let one test's clearFirestore() wipe another's fixtures.
    */
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
