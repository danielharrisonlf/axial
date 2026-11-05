import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    fileParallelism: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
