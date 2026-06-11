import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

const outcomeSchema = z.object({
  testId: z.string().min(1),
  name: z.string().min(1),
  techniqueId: z.string().min(1),
  executed: z.boolean(),
  detectionObserved: z.boolean(),
});

const responseSchema = z.object({
  outcomes: z.array(outcomeSchema).min(1),
});

const requestTestSchema = z.object({
  testId: z.string().min(1),
  name: z.string().min(1),
  techniqueId: z.string().min(1),
  description: z.string().optional(),
  expectedControlIds: z.array(z.string()).optional(),
});

export type LabHarnessProxyEnv = {
  upstreamUrl?: string;
  timeoutMs?: number;
};

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

async function readResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(`Upstream response exceeds ${maxBytes} bytes`);
  }
  return text ? JSON.parse(text) : {};
}

function validateOutcomes(
  requestedTests: Array<{ testId: string; techniqueId: string }>,
  payload: unknown
) {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Upstream response failed schema validation: ${parsed.error.message}`);
  }

  const requestedById = new Map(requestedTests.map((test) => [test.testId, test]));
  const seen = new Set<string>();

  for (const outcome of parsed.data.outcomes) {
    if (seen.has(outcome.testId)) {
      throw new Error(`Upstream returned duplicate testId "${outcome.testId}"`);
    }
    seen.add(outcome.testId);

    const expected = requestedById.get(outcome.testId);
    if (!expected) {
      throw new Error(`Upstream returned unexpected testId "${outcome.testId}"`);
    }
    if (outcome.techniqueId !== expected.techniqueId) {
      throw new Error(
        `Upstream techniqueId mismatch for "${outcome.testId}": expected ${expected.techniqueId}, got ${outcome.techniqueId}`
      );
    }
  }

  for (const test of requestedTests) {
    if (!seen.has(test.testId)) {
      throw new Error(`Upstream missing outcome for requested testId "${test.testId}"`);
    }
  }

  return parsed.data.outcomes;
}

export function resolveLabHarnessProxyEnv(
  env: NodeJS.ProcessEnv = process.env
): LabHarnessProxyEnv {
  return {
    upstreamUrl: env.CYBER_LAB_HARNESS_URL ?? env.VITE_CYBER_LAB_HARNESS_URL,
    timeoutMs: Number(env.CYBER_LAB_HARNESS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export async function handleLabHarnessProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: LabHarnessProxyEnv = resolveLabHarnessProxyEnv()
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const upstreamUrl = env.upstreamUrl?.trim();
  if (!upstreamUrl || upstreamUrl.startsWith("/")) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error:
          "Cyber lab harness proxy is not configured. Set server-side CYBER_LAB_HARNESS_URL to the external lab executor.",
      })
    );
    return;
  }

  let clientPayload: unknown;
  try {
    clientPayload = await readJsonBody(req, MAX_REQUEST_BYTES);
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

  const body = clientPayload as {
    coaId?: string;
    citedFactIds?: string[];
    validatedActionIds?: string[];
    testIds?: string[];
    tests?: unknown[];
  };

  if (!body.coaId || !Array.isArray(body.testIds) || body.testIds.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Request must include coaId and testIds[]" }));
    return;
  }

  const requestedTests = Array.isArray(body.tests)
    ? body.tests
        .map((item) => requestTestSchema.safeParse(item))
        .filter((result) => result.success)
        .map((result) => result.data!)
    : body.testIds.map((testId) => ({
        testId,
        name: testId,
        techniqueId: testId.split("-")[0] ?? testId,
      }));

  if (requestedTests.length !== body.testIds.length) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Request tests[] must match testIds[]" }));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coaId: body.coaId,
        citedFactIds: body.citedFactIds ?? [],
        validatedActionIds: body.validatedActionIds ?? [],
        testIds: body.testIds,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: `Upstream lab harness failed (${upstream.status})`,
        })
      );
      return;
    }

    const upstreamPayload = await readResponseJson(upstream, MAX_RESPONSE_BYTES);
    const outcomes = validateOutcomes(requestedTests, upstreamPayload);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ outcomes }));
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Lab harness proxy request timed out"
        : err instanceof Error
          ? err.message
          : "Lab harness proxy request failed";
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  } finally {
    clearTimeout(timeout);
  }
}
