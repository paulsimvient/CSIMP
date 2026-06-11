import { selectAtomicTestsForTechniques } from "../atomicCatalog";
import { executeLabAtomicTests } from "../labHarness";
import { mapActionsToTechniques } from "../techniqueMap";
import { CyberEmulationPolicyError, LabHarnessUnavailableError } from "../types";
import type {
  AtomicTestExecution,
  CyberEmulationProviderFn,
  CyberEffectResult,
} from "../types";

/**
 * Phase 2: small allowlisted Atomic-style validation checks in lab only.
 * Requires human approval and lab environment confirmation (enforced in adapter).
 */
export const atomicRedTeamProvider: CyberEmulationProviderFn = async (
  request
): Promise<CyberEffectResult> => {
  const techniques = mapActionsToTechniques(
    request.actionDescriptions,
    request.actionTypes
  );
  const techniqueIds = techniques.map((t) => t.techniqueId);
  const tests = selectAtomicTestsForTechniques(techniqueIds);

  if (tests.length === 0) {
    throw new CyberEmulationPolicyError({
      code: "technique-not-allowlisted",
      message:
        "No allowlisted Atomic lab tests match the validated cyber action techniques.",
    });
  }

  let harness;
  try {
    harness = await executeLabAtomicTests({
      coaId: request.coaId,
      citedFactIds: request.citedFactIds,
      validatedActionIds: request.validatedActionIds,
      tests,
    });
  } catch (err) {
    if (err instanceof LabHarnessUnavailableError) {
      return buildLabUnavailableResult(request, techniques, err.message);
    }
    throw err;
  }

  const harnessKind = harness.outcomes[0]?.harness;
  if (harnessKind !== "http") {
    return buildInProcessSimulationResult(request, techniques, harness, tests);
  }

  return buildLabExecutedResult(request, techniques, harness, tests);
};

function buildLabExecutedResult(
  request: Parameters<CyberEmulationProviderFn>[0],
  techniques: CyberEffectResult["techniquesEvaluated"],
  harness: Awaited<ReturnType<typeof executeLabAtomicTests>>,
  tests: ReturnType<typeof selectAtomicTestsForTechniques>
): CyberEffectResult {
  const atomicTestsExecuted = mapAtomicTests(harness.outcomes);
  const { executed, detected, detectionRate } = detectionStats(harness.outcomes);
  const techniqueIds = techniques.map((t) => t.techniqueId);

  const residualRisk = clamp(
    0.7 - detectionRate * 0.45 - request.citedFactIds.length * 0.03,
    0.1,
    0.75
  );
  const confidence = clamp(
    0.55 + detectionRate * 0.35 + Math.min(tests.length, 3) * 0.05,
    0.4,
    0.95
  );

  return {
    coaId: request.coaId,
    validatedActionIds: request.validatedActionIds,
    citedFactIds: request.citedFactIds,
    provider: "atomic-red-team",
    executionMode: "lab-executed",
    residualRisk,
    confidence,
    techniquesEvaluated: techniques,
    expectedDetections: harness.expectedDetections,
    observedDetections: harness.observedDetections,
    atomicTestsExecuted,
    explanation: [
      `Lab cyber-effects validation (${executed} Atomic test(s)) via external lab harness.`,
      `Detections observed for ${detected}/${executed} test(s).`,
      `Techniques: ${techniqueIds.join(", ") || "none"}.`,
      `Residual risk ${Math.round(residualRisk * 100)}% based on lab detection coverage.`,
      "Lab-only execution — not production.",
    ].join(" "),
    evidenceRefs: [
      ...request.citedFactIds,
      ...atomicTestsExecuted.map((t) => `atomic:${t.testId}`),
    ],
  };
}

function buildInProcessSimulationResult(
  request: Parameters<CyberEmulationProviderFn>[0],
  techniques: CyberEffectResult["techniquesEvaluated"],
  harness: Awaited<ReturnType<typeof executeLabAtomicTests>>,
  tests: ReturnType<typeof selectAtomicTestsForTechniques>
): CyberEffectResult {
  const atomicTestsExecuted = mapAtomicTests(harness.outcomes);
  const { executed, detected, detectionRate } = detectionStats(harness.outcomes);

  const residualRisk = clamp(0.65 - detectionRate * 0.35, 0.2, 0.8);
  const confidence = clamp(0.5 + detectionRate * 0.25, 0.35, 0.85);

  return {
    coaId: request.coaId,
    validatedActionIds: request.validatedActionIds,
    citedFactIds: request.citedFactIds,
    provider: "atomic-red-team",
    executionMode: "in-process-simulation",
    residualRisk,
    confidence,
    techniquesEvaluated: techniques,
    expectedDetections: harness.expectedDetections,
    observedDetections: harness.observedDetections,
    atomicTestsExecuted,
    explanation: [
      `In-process cyber simulation (${executed} Atomic-style check(s)) — not lab execution.`,
      `Detections observed for ${detected}/${executed} test(s).`,
      "Enabled only via VITE_CYBER_ALLOW_IN_PROCESS_LAB or explicit test opt-in.",
    ].join(" "),
    evidenceRefs: [
      ...request.citedFactIds,
      ...atomicTestsExecuted.map((t) => `atomic:${t.testId}`),
    ],
  };
}

function buildLabUnavailableResult(
  request: Parameters<CyberEmulationProviderFn>[0],
  techniques: CyberEffectResult["techniquesEvaluated"],
  detail: string
): CyberEffectResult {
  return {
    coaId: request.coaId,
    validatedActionIds: request.validatedActionIds,
    citedFactIds: request.citedFactIds,
    provider: "atomic-red-team",
    executionMode: "lab-unavailable",
    residualRisk: 0.75,
    confidence: 0.35,
    techniquesEvaluated: techniques,
    expectedDetections: [],
    observedDetections: [],
    explanation: [
      "Lab harness unavailable — no lab execution was performed.",
      detail,
      "Configure VITE_CYBER_LAB_HARNESS_URL or use simulated cyber mode.",
    ].join(" "),
    evidenceRefs: [...request.citedFactIds],
  };
}

function mapAtomicTests(
  outcomes: Awaited<ReturnType<typeof executeLabAtomicTests>>["outcomes"]
): AtomicTestExecution[] {
  return outcomes.map((o) => ({
    testId: o.testId,
    name: o.name,
    techniqueId: o.techniqueId,
    detectionObserved: o.detectionObserved,
    harness: o.harness,
  }));
}

function detectionStats(outcomes: Awaited<ReturnType<typeof executeLabAtomicTests>>["outcomes"]) {
  const executedOutcomes = outcomes.filter((o) => o.executed);
  const executed = executedOutcomes.length;
  const detected = executedOutcomes.filter((o) => o.detectionObserved).length;
  return {
    executed,
    detected,
    detectionRate: executed > 0 ? detected / executed : 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
