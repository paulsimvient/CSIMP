import { z } from "zod";
import type { AtomicLabTest } from "./atomicCatalog";
import type { LabHarnessTestOutcome } from "./labHarness";

export const LAB_HARNESS_TIMEOUT_MS = 30_000;
export const LAB_HARNESS_MAX_RESPONSE_BYTES = 256 * 1024;

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

export class LabHarnessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabHarnessValidationError";
  }
}

export function validateHarnessResponse(
  requestedTests: AtomicLabTest[],
  payload: unknown
): LabHarnessTestOutcome[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LabHarnessValidationError(
      `Lab harness response failed schema validation: ${parsed.error.message}`
    );
  }

  const requestedById = new Map(requestedTests.map((test) => [test.testId, test]));
  const seen = new Set<string>();
  const validated: LabHarnessTestOutcome[] = [];

  for (const outcome of parsed.data.outcomes) {
    if (seen.has(outcome.testId)) {
      throw new LabHarnessValidationError(
        `Lab harness returned duplicate testId "${outcome.testId}"`
      );
    }
    seen.add(outcome.testId);

    const expected = requestedById.get(outcome.testId);
    if (!expected) {
      throw new LabHarnessValidationError(
        `Lab harness returned unexpected testId "${outcome.testId}"`
      );
    }
    if (outcome.techniqueId !== expected.techniqueId) {
      throw new LabHarnessValidationError(
        `Lab harness techniqueId mismatch for "${outcome.testId}": expected ${expected.techniqueId}, got ${outcome.techniqueId}`
      );
    }

    validated.push({
      ...outcome,
      harness: "http",
    });
  }

  for (const test of requestedTests) {
    if (!seen.has(test.testId)) {
      throw new LabHarnessValidationError(
        `Lab harness missing outcome for requested testId "${test.testId}"`
      );
    }
  }

  return validated;
}

export async function readJsonWithByteLimit(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new LabHarnessValidationError(
        `Lab harness response exceeds ${maxBytes} bytes`
      );
    }
    return text ? JSON.parse(text) : {};
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new LabHarnessValidationError(
        `Lab harness response exceeds ${maxBytes} bytes`
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new LabHarnessValidationError("Lab harness returned invalid JSON");
  }
}
