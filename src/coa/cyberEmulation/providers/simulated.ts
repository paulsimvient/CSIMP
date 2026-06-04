import { assertAllowlistedTechniques } from "../allowlist";
import { mapActionsToTechniques } from "../techniqueMap";
import type { CyberEmulationProviderFn, CyberEffectResult, DetectionExpectation } from "../types";

function defaultDetections(techniqueIds: string[]): {
  expected: DetectionExpectation[];
  observed: DetectionExpectation[];
} {
  const controls: DetectionExpectation[] = [
    {
      controlId: "siem-auth-anomaly",
      label: "SIEM authentication anomaly rule",
      expected: techniqueIds.includes("T1078") || techniqueIds.includes("T1110"),
    },
    {
      controlId: "ndr-lateral-beacon",
      label: "NDR C2 protocol heuristic",
      expected: techniqueIds.includes("T1071"),
    },
    {
      controlId: "edr-process-discovery",
      label: "EDR process discovery chain",
      expected: techniqueIds.includes("T1057") || techniqueIds.includes("T1082"),
    },
  ].filter((c) => c.expected);

  const observed = controls.map((c, index) => ({
    ...c,
    observed: c.expected ? index % 3 !== 0 : false,
  }));

  return { expected: controls, observed };
}

/**
 * Phase 1: ATT&CK-mapped cyber effects simulation for COA scoring.
 * No network calls, no exploit generation, no external orchestration.
 */
export const simulatedCyberProvider: CyberEmulationProviderFn = async (
  request
): Promise<CyberEffectResult> => {
  const techniques = mapActionsToTechniques(
    request.actionDescriptions,
    request.actionTypes
  );
  const techniqueIds = techniques.map((t) => t.techniqueId);
  assertAllowlistedTechniques(techniqueIds);

  const detectionCoverage =
    techniques.length > 0
      ? techniques.filter((t) =>
          ["T1078", "T1110", "T1071", "T1057"].includes(t.techniqueId)
        ).length / techniques.length
      : 0.4;

  const residualRisk = clamp(
    0.55 -
      detectionCoverage * 0.25 -
      Math.min(request.citedFactIds.length, 3) * 0.05,
    0.15,
    0.85
  );
  const confidence = clamp(
    0.45 + detectionCoverage * 0.35 + Math.min(request.validatedActionIds.length, 2) * 0.08,
    0.35,
    0.92
  );

  const { expected, observed } = defaultDetections(techniqueIds);

  const explanation = [
    `Simulated cyber-effects assessment for ${request.validatedActionIds.length} validated action(s).`,
    techniques.length > 0
      ? `Mapped to ${techniques.map((t) => t.techniqueId).join(", ")} (defensive assessment scope).`
      : "No ATT&CK mapping — generic defensive posture only.",
    `Residual risk ${Math.round(residualRisk * 100)}% after expected control coverage.`,
    "No lab execution — simulation only.",
  ].join(" ");

  return {
    coaId: request.coaId,
    validatedActionIds: request.validatedActionIds,
    citedFactIds: request.citedFactIds,
    provider: "simulated",
    executionMode: "simulation",
    residualRisk,
    confidence,
    techniquesEvaluated: techniques,
    expectedDetections: expected,
    observedDetections: observed,
    explanation,
    evidenceRefs: [...request.citedFactIds],
  };
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
