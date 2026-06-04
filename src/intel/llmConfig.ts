export type LlmProvider = "ollama" | "openai" | "stub";

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  /** Ollama base URL, e.g. http://localhost:11434 */
  ollamaBaseUrl: string;
  /** OpenAI-compatible chat completions URL (local Ollama or server proxy). */
  openaiEndpoint: string;
  /** True when remote calls must go through /api/llm (no browser API key). */
  usesServerProxy: boolean;
};

const DEFAULT_OLLAMA_BASE = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";
const LLM_PROXY_PATH = "/api/llm";

function isLocalOllamaEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url, "http://localhost");
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      (parsed.port === "11434" || parsed.pathname.includes("11434"))
    );
  } catch {
    return url.includes("11434");
  }
}

export function getLlmConfig(): LlmConfig {
  const provider = resolveProvider();
  const model = (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? DEFAULT_MODEL;
  const ollamaBaseUrl =
    (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined) ?? DEFAULT_OLLAMA_BASE;
  const configuredEndpoint =
    (import.meta.env.VITE_LLM_ENDPOINT as string | undefined) ??
    `${DEFAULT_OLLAMA_BASE}/v1/chat/completions`;

  if (provider === "openai") {
    return {
      provider,
      model,
      ollamaBaseUrl,
      openaiEndpoint: LLM_PROXY_PATH,
      usesServerProxy: true,
    };
  }

  return {
    provider,
    model,
    ollamaBaseUrl,
    openaiEndpoint: configuredEndpoint,
    usesServerProxy: false,
  };
}

export function usesLiveLlm(config: LlmConfig = getLlmConfig()): boolean {
  return config.provider !== "stub";
}

export function getLlmStatus(config: LlmConfig = getLlmConfig()): {
  label: string;
  mode: "live" | "stub";
} {
  if (!usesLiveLlm(config)) {
    return {
      label: "LLM stub",
      mode: "stub",
    };
  }

  if (config.usesServerProxy) {
    return {
      label: `${config.provider}:${config.model} (server proxy)`,
      mode: "live",
    };
  }

  return {
    label: `${config.provider}:${config.model}`,
    mode: "live",
  };
}

function resolveProvider(): LlmProvider {
  const explicit = import.meta.env.VITE_LLM_PROVIDER as string | undefined;

  if (explicit === "stub") return "stub";
  if (explicit === "openai") return "openai";
  if (explicit === "ollama") return "ollama";

  const endpoint = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
  if (endpoint && !isLocalOllamaEndpoint(endpoint)) return "openai";

  const ollamaBase = import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined;
  if (ollamaBase || endpoint?.includes("11434")) return "ollama";

  if (!explicit && !endpoint && !ollamaBase) return "stub";

  return "ollama";
}
