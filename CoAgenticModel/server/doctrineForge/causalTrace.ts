import { createHash, randomUUID } from "node:crypto";
import type { CausalTrace, Predicate } from "../../src/types/doctrine";
import type { GroundingValidationResult } from "../../../src/intel/types";
import type { LLMInterpretation, ScenarioPacket } from "../../../src/intel/types";
import { validateGrounding } from "../../../src/intel/grounding";
import { DEFAULT_GROUNDING_POLICY } from "../../../src/intel/groundingPolicy";

export function classifyFailureClass(grounding: GroundingValidationResult): string {
  const kinds = new Set(grounding.issues.map((i) => i.kind));
  if (kinds.has("hallucinated-fact-id")) return "hallucinated-fact-provenance";
  if (kinds.has("hedge-violation")) return "attribution-confidence-overreach";
  if (kinds.has("unsupported-action")) return "unsupported-target-action";
  if (kinds.has("constraint-violation")) return "implicit-assumption-violation";
  if (kinds.has("missing-authority-state")) return "authority-compliance-failure";
  if (kinds.has("confidence-exceeds-evidence")) return "confidence-calibration-failure";
  if (kinds.has("evidence-conflict")) return "conflicting-sensor-evidence";
  return grounding.valid ? "no-failure" : "grounding-validation-failure";
}

export function buildMinimalCounterexample(
  grounding: GroundingValidationResult,
  interpretation: LLMInterpretation
): string {
  const primary = grounding.issues[0];
  if (!primary) return "No blocking issues recorded.";

  switch (primary.kind) {
    case "hallucinated-fact-id":
      return `Interpretation cited fact ID "${primary.id}" which is not in the scenario packet.`;
    case "hedge-violation":
      return `Claim "${primary.claim}" uses forbidden hedge language ("${primary.forbiddenWord}").`;
    case "unsupported-action":
      return `Action "${primary.actionId}" lacks sufficient grounding: ${primary.reason}`;
    case "constraint-violation":
      return `Violated constraint "${primary.constraint}" in ${primary.foundIn}.`;
    case "missing-authority-state":
      return `Action "${primary.actionId}" references authority "${primary.authority}" without a known state.`;
    case "confidence-exceeds-evidence":
      return `Action "${primary.actionId}" confidence exceeds evidence: ${primary.reason}`;
    default:
      return `Grounding issue: ${primary.kind}`;
  }
}

export function buildCausalTrace(input: {
  scenarioRef: string;
  packet: ScenarioPacket;
  interpretation: LLMInterpretation;
  evidenceRefs?: string[];
}): { trace: CausalTrace; grounding: GroundingValidationResult } {
  const grounding = validateGrounding(input.packet, input.interpretation, DEFAULT_GROUNDING_POLICY);
  const failureClass = classifyFailureClass(grounding);

  const trace: CausalTrace = {
    traceId: randomUUID().slice(0, 12),
    scenarioRef: input.scenarioRef,
    failureClass,
    summary: grounding.valid
      ? "No grounding failure detected"
      : `${grounding.blockingIssues} blocking grounding issue(s) in ${input.scenarioRef}`,
    minimalCounterexample: buildMinimalCounterexample(grounding, input.interpretation),
    violatedInvariantIds: grounding.issues.map((i) => i.kind),
    groundingIssueKinds: [...new Set(grounding.issues.map((i) => i.kind))],
    evidenceRefs: input.evidenceRefs ?? [],
    observedAt: new Date().toISOString(),
  };

  return { trace, grounding };
}

export function buildRegressionPredicate(
  failureClass: string,
  groundingIssueKinds: string[]
): Predicate {
  const expression = JSON.stringify({ failureClass, groundingIssueKinds });
  return {
    id: `regression-${createHash("sha256").update(expression).digest("hex").slice(0, 10)}`,
    expression,
    description: `Reject variants that reintroduce ${failureClass} (${groundingIssueKinds.join(", ")})`,
  };
}

export function matchesRegressionPredicate(
  predicate: Predicate,
  trace: CausalTrace
): boolean {
  try {
    const parsed = JSON.parse(predicate.expression) as {
      failureClass?: string;
      groundingIssueKinds?: string[];
    };
    if (parsed.failureClass && parsed.failureClass === trace.failureClass) return true;
    if (parsed.groundingIssueKinds) {
      return parsed.groundingIssueKinds.some((kind) =>
        trace.groundingIssueKinds.includes(kind)
      );
    }
  } catch {
    return trace.failureClass === predicate.description;
  }
  return false;
}
