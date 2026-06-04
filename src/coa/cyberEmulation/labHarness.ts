import type { AtomicLabTest } from "./atomicCatalog";
import type { DetectionExpectation } from "./types";
import { LabHarnessUnavailableError } from "./types";

export type LabHarnessRequest = {
  coaId: string;
  citedFactIds: string[];
  validatedActionIds: string[];
  tests: AtomicLabTest[];
};

export type LabHarnessTestOutcome = {
  testId: string;
  name: string;
  techniqueId: string;
  executed: boolean;
  detectionObserved: boolean;
  harness: "in-process" | "http";
};

export type LabHarnessResult = {
  outcomes: LabHarnessTestOutcome[];
  expectedDetections: DetectionExpectation[];
  observedDetections: DetectionExpectation[];
};

export type LabHarnessOptions = {
  /** Dev/test only — never enable in production deployments. */
  allowInProcess?: boolean;
};

function allowInProcessFallback(options?: LabHarnessOptions): boolean {
  if (options?.allowInProcess) return true;
  return import.meta.env.VITE_CYBER_ALLOW_IN_PROCESS_LAB === "true";
}

/**
 * Executes allowlisted atomic validation checks against the lab harness.
 * Requires VITE_CYBER_LAB_HARNESS_URL unless an explicit in-process fallback is allowed.
 */
export async function executeLabAtomicTests(
  request: LabHarnessRequest,
  options?: LabHarnessOptions
): Promise<LabHarnessResult> {
  const url = import.meta.env.VITE_CYBER_LAB_HARNESS_URL as string | undefined;
  if (url && url.trim() !== "") {
    return executeViaHttpHarness(url.trim(), request);
  }

  if (allowInProcessFallback(options)) {
    return executeInProcessLabTests(request);
  }

  throw new LabHarnessUnavailableError(
    "Lab harness URL is not configured. Set VITE_CYBER_LAB_HARNESS_URL or use simulated cyber mode."
  );
}

async function executeViaHttpHarness(
  url: string,
  request: LabHarnessRequest
): Promise<LabHarnessResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coaId: request.coaId,
        citedFactIds: request.citedFactIds,
        validatedActionIds: request.validatedActionIds,
        testIds: request.tests.map((t) => t.testId),
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new LabHarnessUnavailableError(
      `External lab harness unreachable at ${url}: ${detail}`
    );
  }

  if (!response.ok) {
    throw new LabHarnessUnavailableError(
      `Lab harness HTTP ${response.status}: ${response.statusText}`
    );
  }

  const payload = (await response.json()) as {
    outcomes?: LabHarnessTestOutcome[];
  };

  if (!Array.isArray(payload.outcomes) || payload.outcomes.length === 0) {
    throw new LabHarnessUnavailableError("Lab harness returned no outcomes");
  }

  return buildHarnessResult(request.tests, payload.outcomes, "http");
}

function executeInProcessLabTests(request: LabHarnessRequest): LabHarnessResult {
  const outcomes: LabHarnessTestOutcome[] = request.tests.map(
    (test) => {
      const detectionObserved = deterministicDetectionObserved(
        request.coaId,
        test.testId,
        request.citedFactIds
      );
      return {
        testId: test.testId,
        name: test.name,
        techniqueId: test.techniqueId,
        executed: true,
        detectionObserved,
        harness: "in-process" as const,
      };
    }
  );

  return buildHarnessResult(request.tests, outcomes, "in-process");
}

function buildHarnessResult(
  tests: AtomicLabTest[],
  outcomes: LabHarnessTestOutcome[],
  harness: "in-process" | "http"
): LabHarnessResult {
  const controlMap = new Map<string, DetectionExpectation>();

  for (const test of tests) {
    for (const controlId of test.expectedControlIds) {
      if (!controlMap.has(controlId)) {
        const label = controlLabel(controlId);
        controlMap.set(controlId, {
          controlId,
          label,
          expected: true,
        });
      }
    }
  }

  const expectedDetections = Array.from(controlMap.values());
  const observedDetections = expectedDetections.map((detection) => {
    const related = outcomes.filter((o) =>
      tests
        .find((t) => t.testId === o.testId)
        ?.expectedControlIds.includes(detection.controlId)
    );
    const observed =
      related.length > 0 && related.every((o) => o.detectionObserved);
    return {
      ...detection,
      observed,
    };
  });

  return {
    outcomes: outcomes.map((o) => ({ ...o, harness })),
    expectedDetections,
    observedDetections,
  };
}

function deterministicDetectionObserved(
  coaId: string,
  testId: string,
  citedFactIds: string[]
): boolean {
  let hash = 0;
  const seed = `${coaId}:${testId}:${citedFactIds.sort().join(",")}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1000;
  }
  return hash % 5 !== 0;
}

function controlLabel(controlId: string): string {
  const labels: Record<string, string> = {
    "siem-auth-anomaly": "SIEM authentication anomaly rule",
    "ndr-lateral-beacon": "NDR C2 / scan heuristic",
    "edr-process-discovery": "EDR process discovery chain",
  };
  return labels[controlId] ?? controlId;
}
