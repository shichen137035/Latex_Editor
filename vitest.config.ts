import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    includeTaskLocation: true,
    slowTestThreshold: 1000,
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: 0,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "compiler",
          include: ["tests/compiler/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "cli-e2e",
          include: ["tests/e2e-cli/**/*.test.ts"]
        }
      }
    ]
  }
});
