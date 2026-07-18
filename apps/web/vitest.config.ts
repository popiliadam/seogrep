import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "components/**/*.test.tsx",
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  esbuild: { jsx: "automatic" }
});
