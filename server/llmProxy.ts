import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_TIMEOUT_MS = 60_000;

export type LlmProxyEnv = {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type LlmProxyRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string };
  temperature?: number;
};

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function isLocalDevEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      parsed.port === "11434"
    );
  } catch {
    return false;
  }
}

export function resolveLlmProxyEnv(env: NodeJS.ProcessEnv = process.env): LlmProxyEnv {
  const endpoint = env.LLM_ENDPOINT ?? env.VITE_LLM_ENDPOINT;
  const apiKey = env.LLM_API_KEY;
  return {
    endpoint,
    apiKey,
    timeoutMs: Number(env.LLM_PROXY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export async function handleLlmProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: LlmProxyEnv = resolveLlmProxyEnv()
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const endpoint = env.endpoint?.trim();
  const apiKey = env.apiKey?.trim();

  if (!endpoint || !apiKey) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error:
          "LLM proxy is not configured. Set server-side LLM_ENDPOINT and LLM_API_KEY (never use VITE_ prefix for secrets).",
      })
    );
    return;
  }

  if (isLocalDevEndpoint(endpoint)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error:
          "Use direct local Ollama access for localhost:11434. The /api/llm proxy is for remote OpenAI-compatible providers only.",
      })
    );
    return;
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const body = payload as Partial<LlmProxyRequest>;
  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Request must include model and messages[]" }));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        response_format: body.response_format ?? { type: "json_object" },
        temperature: body.temperature ?? 0.2,
      }),
      signal: controller.signal,
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    if (!upstream.ok) {
      res.end(
        JSON.stringify({
          error: `Upstream LLM request failed (${upstream.status})`,
          detail: sanitizeProxyError(text),
        })
      );
      return;
    }
    res.end(text);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "LLM proxy request timed out"
        : "LLM proxy request failed";
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeProxyError(detail: string): string {
  return detail.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}
