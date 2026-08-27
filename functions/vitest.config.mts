import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Server code. No jsdom, no browser globals — if something in here needs a
    // DOM, it is in the wrong workspace.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
