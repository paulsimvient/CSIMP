import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CONTENT_CHARS = 50_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

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

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(MAX_MESSAGE_CONTENT_CHARS),
});

const requestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  response_format: z.object({ type: z.string() }).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const rateLimitByIp = new Map<string, { count: number; windowStart: number }>();

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
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

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = rateLimitByIp.get(ip);
  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
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

  if (isRateLimited(clientIp(req))) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "LLM proxy rate limit exceeded" }));
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
    payload = await readJsonBody(req, MAX_REQUEST_BYTES);
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Invalid JSON body",
      })
    );
    return;
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Request failed schema validation",
        detail: parsed.error.message,
      })
    );
    return;
  }

  const body = parsed.data;
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
    if (text.length > MAX_RESPONSE_BYTES) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Upstream LLM response exceeded size limit" }));
      return;
    }

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
