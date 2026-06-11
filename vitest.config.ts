import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@coda/intel": resolve(__dirname, "src/intel"),
    },
  },
  test: {
    env: {
      VITE_CYBER_ALLOW_IN_PROCESS_LAB: "true",
    },
  },
});
