import { describe, expect, it } from "vitest";
import { handleLlmProxyRequest, resolveLlmProxyEnv } from "./llmProxy";

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = chunk ?? "";
    },
  };
  return res;
}

describe("llmProxy", () => {
  it("requires server-side endpoint and api key", async () => {
    const res = mockResponse();
    await handleLlmProxyRequest(
      { method: "POST", on: () => undefined } as any,
      res as any,
      {}
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("LLM proxy is not configured");
  });

  it("rejects localhost Ollama endpoints", async () => {
    const res = mockResponse();
    await handleLlmProxyRequest(
      { method: "POST", on: () => undefined } as any,
      res as any,
      {
        endpoint: "http://localhost:11434/v1/chat/completions",
        apiKey: "secret",
      }
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("direct local Ollama");
  });

  it("reads env from non-VITE variables", () => {
    const env = resolveLlmProxyEnv({
      LLM_ENDPOINT: "https://api.example.com/v1/chat/completions",
      LLM_API_KEY: "server-key",
    } as NodeJS.ProcessEnv);
    expect(env.endpoint).toContain("api.example.com");
    expect(env.apiKey).toBe("server-key");
  });
});
