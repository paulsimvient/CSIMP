import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { ingestPayload } from "../src/intel/ingest";
import { intelIngestBodySchema } from "../src/schemas/intelIngest";
import {
  appendIngestFacts,
  getIngestStatusStore,
  readIngestEventsSince,
} from "./intelIngestStore";
import { getStreamIngestStatus } from "./streamIngest";

const MAX_REQUEST_BYTES = 512 * 1024;

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

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  const required = env.INTEL_INGEST_API_KEY?.trim();
  if (!required) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${required}`) return true;
  const apiKey = req.headers["x-api-key"];
  return typeof apiKey === "string" && apiKey === required;
}

function requestPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.pathname;
}

function querySince(req: IncomingMessage): number {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("since");
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export async function handleIntelIngestRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = requestPath(req);

  if (path === "/api/intel/ingest/status") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    writeJson(res, 200, {
      store: getIngestStatusStore(),
      stream: getStreamIngestStatus(),
    });
    return;
  }

  if (path !== "/api/intel/ingest") {
    writeJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    const since = querySince(req);
    const { cursor, added, truncated } = readIngestEventsSince(since);
    writeJson(res, 200, { cursor, added, since, truncated });
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req, env)) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_REQUEST_BYTES);
    const parsed = intelIngestBodySchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, {
        error: "Invalid ingest payload",
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      return;
    }

    const facts = ingestPayload(parsed.data);
    const result = appendIngestFacts(facts);
    writeJson(res, 202, {
      accepted: result.added.length,
      duplicate: result.duplicateCount,
      cursor: result.cursor,
      added: result.added,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeJson(res, 500, { error: message });
  }
}
