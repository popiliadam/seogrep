import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "components/**/*.test.tsx"],
  },
  esbuild: { jsx: "automatic" }
});
