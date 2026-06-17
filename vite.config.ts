import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { handleAgentEvolutionRequest } from "./CoAgenticModel/server/http";
import { handleIntelIngestRequest } from "./server/intelIngest";
import { handleLabHarnessProxyRequest } from "./server/labHarnessProxy";
import { handleLlmProxyRequest } from "./server/llmProxy";
import { startStreamIngest } from "./server/streamIngest";

function apiProxyPlugin(): Plugin {
  return {
    name: "api-proxy",
    configureServer(server) {
      server.middlewares.use("/api/llm", (req, res) => {
        void handleLlmProxyRequest(req, res);
      });
      server.middlewares.use("/api/cyber-lab", (req, res) => {
        void handleLabHarnessProxyRequest(req, res);
      });
      server.middlewares.use("/api/agent-evolution", (req, res) => {
        void handleAgentEvolutionRequest(req, res);
      });
      server.middlewares.use("/api/intel/ingest", (req, res) => {
        void handleIntelIngestRequest(req, res);
      });
      server.middlewares.use("/api/intel/ingest/status", (req, res) => {
        void handleIntelIngestRequest(req, res);
      });
      void startStreamIngest().catch((err) => {
        console.warn("[intel-ingest] stream consumer failed to start:", err);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/llm", (req, res) => {
        void handleLlmProxyRequest(req, res);
      });
      server.middlewares.use("/api/cyber-lab", (req, res) => {
        void handleLabHarnessProxyRequest(req, res);
      });
      server.middlewares.use("/api/agent-evolution", (req, res) => {
        void handleAgentEvolutionRequest(req, res);
      });
      server.middlewares.use("/api/intel/ingest", (req, res) => {
        void handleIntelIngestRequest(req, res);
      });
      server.middlewares.use("/api/intel/ingest/status", (req, res) => {
        void handleIntelIngestRequest(req, res);
      });
      void startStreamIngest().catch((err) => {
        console.warn("[intel-ingest] stream consumer failed to start:", err);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
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
          return undefined;
        },
      },
    },
  },
});
