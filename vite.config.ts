import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { handleLlmProxyRequest } from "./server/llmProxy";

function llmProxyPlugin(): Plugin {
  return {
    name: "llm-proxy",
    configureServer(server) {
      server.middlewares.use("/api/llm", (req, res) => {
        void handleLlmProxyRequest(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/llm", (req, res) => {
        void handleLlmProxyRequest(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), llmProxyPlugin()],
  resolve: {
    alias: {
      "@coa": resolve(__dirname, "src/coa"),
      "@components": resolve(__dirname, "src/components"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules/sql.js")) return "sqljs";
        },
      },
    },
  },
  test: {
    env: {
      VITE_CYBER_ALLOW_IN_PROCESS_LAB: "true",
    },
  },
});
