import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Measure the shipped library only. The test files and the test-only
      // helpers (setup-real-server, test-events) are not part of smocket.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/setup-real-server.ts",
        "src/test-events.ts",
      ],
      // No threshold yet: the suite currently exercises real socket.io, not
      // smocket's own code, so the number is not meaningful until the
      // implementation lands. Revisit once delivery branching gets complex.
    },
  },
});
