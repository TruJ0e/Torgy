import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["apps/web-codex/**", "node_modules/**"],
  },
});
