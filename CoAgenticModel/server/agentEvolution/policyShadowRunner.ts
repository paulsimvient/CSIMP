import type { PolicyChange } from "../../src/types/proposal";
import type { ShadowComparisonResult, ShadowSafetyMetrics } from "../../src/types/shadow";
import type { EvaluationRunRecord } from "../../src/types/release";
import { loadPolicyBundle } from "./loadPolicyBundle";
import { simulatePolicyBundle } from "./simulatePolicy";
import { scoreShadowRun } from "./shadow";
import { runPolicyShadowMetrics } from "../../../src/intel/policyShadowEval";
import { groundingConfigFromBundle } from "../../src/types/policy";

export type ShadowRunResult = {
  evalRun: EvaluationRunRecord;
  productionMetrics: ShadowSafetyMetrics;
  candidateMetrics: ShadowSafetyMetrics;
  comparison: ShadowComparisonResult;
  mode: "policy-fixtures" | "vitest";
};

function toShadowSafetyMetrics(
  metrics: ReturnType<typeof runPolicyShadowMetrics>
): ShadowSafetyMetrics {
  return {
    schemaValid: metrics.schemaValid,
    groundingPassRate: metrics.groundingPassRate,
    hallucinatedFactIds: metrics.hallucinatedFactIds,
    unsupportedActions: metrics.unsupportedActions,
    constraintViolations: metrics.constraintViolations,
    confidenceInflation: metrics.confidenceInflation,
  };
}

/**
 * Compare production vs candidate registry policy using fixed grounding fixtures.
 * When policyChanges are provided, simulates candidate before disk materialization.
 */
export async function runPolicyShadowComparison(input: {
  repoRoot: string;
  agentId: string;
  productionVersion: string;
  candidateVersion: string;
  releaseId: string;
  scenarioId?: string;
  policyChanges?: PolicyChange[];
}): Promise<ShadowRunResult> {
  const scenarioId = input.scenarioId ?? "policy-fixtures";
  const started = Date.now();

  const productionBundle = await loadPolicyBundle(
    input.repoRoot,
    input.agentId,
    input.productionVersion
  );

  const candidateBundle = input.policyChanges?.length
    ? simulatePolicyBundle(
        productionBundle,
        input.policyChanges,
        input.candidateVersion
      )
    : await loadPolicyBundle(input.repoRoot, input.agentId, input.candidateVersion);

  const productionMetrics = toShadowSafetyMetrics(
    runPolicyShadowMetrics(groundingConfigFromBundle(productionBundle))
  );
  const candidateMetrics = toShadowSafetyMetrics(
    runPolicyShadowMetrics(groundingConfigFromBundle(candidateBundle))
  );

  const comparison = scoreShadowRun({
    productionVersion: input.productionVersion,
    candidateVersion: input.candidateVersion,
    releaseId: input.releaseId,
    scenarioId,
    candidate: candidateMetrics,
    production: productionMetrics,
    latencyMs: Date.now() - started,
    productionLatencyMs: Date.now() - started,
  });

  const evalRun: EvaluationRunRecord = {
    suite: `${input.agentId}:policy-shadow`,
    passed: comparison.promoted,
    metrics: {
      durationMs: Date.now() - started,
      scenarioCount: 3,
      groundingPassRate: candidateMetrics.groundingPassRate,
      productionPassRate: productionMetrics.groundingPassRate,
    },
    reportArtifact: `policy-shadow-${input.agentId}-${Date.now()}.json`,
  };

  return {
    evalRun,
    productionMetrics,
    candidateMetrics,
    comparison,
    mode: "policy-fixtures",
  };
}
