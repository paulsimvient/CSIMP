/**
 * Platform operational invariants — host-owned, not evolvable by agents.
 */

import { validateGrounding } from "./grounding";
import type { GroundingPolicyConfig } from "./groundingPolicy";
import { DEFAULT_GROUNDING_POLICY } from "./groundingPolicy";
import type { LLMInterpretation, ScenarioPacket } from "./types";

export type OperationalInvariantDef = {
  id: string;
  label: string;
  category:
    | "fact-provenance"
    | "authority"
    | "grounding"
    | "logistics"
    | "cyber-allowlist"
    | "attribution";
};

export type InvariantEvaluationResult = {
  invariantId: string;
  passed: boolean;
  violations: string[];
};

export const PLATFORM_OPERATIONAL_INVARIANTS: OperationalInvariantDef[] = [
  { id: "fact-provenance", label: "No hallucinated fact IDs", category: "fact-provenance" },
  { id: "grounding-citation", label: "Actions cite observed facts", category: "grounding" },
  { id: "attribution-discipline", label: "No hedge violations on attribution", category: "attribution" },
  { id: "constraint-compliance", label: "No explicit constraint violations", category: "grounding" },
  { id: "authority-respect", label: "No missing authority states on actions", category: "authority" },
];

export function evaluateOperationalInvariants(
  packet: ScenarioPacket,
  interpretation: LLMInterpretation,
  policy: GroundingPolicyConfig = DEFAULT_GROUNDING_POLICY
): InvariantEvaluationResult[] {
  const grounding = validateGrounding(packet, interpretation, policy);
  const results: InvariantEvaluationResult[] = [];

  const hallucinated = grounding.issues.filter((i) => i.kind === "hallucinated-fact-id");
  results.push({
    invariantId: "fact-provenance",
    passed: hallucinated.length === 0,
    violations: hallucinated.map((i) => `hallucinated-fact-id: ${i.id}`),
  });

  const unsupported = grounding.issues.filter((i) => i.kind === "unsupported-action");
  results.push({
    invariantId: "grounding-citation",
    passed: unsupported.length === 0,
    violations: unsupported.map((i) => `unsupported-action: ${i.actionId}`),
  });

  const hedges = grounding.issues.filter((i) => i.kind === "hedge-violation");
  results.push({
    invariantId: "attribution-discipline",
    passed: hedges.length === 0,
    violations: hedges.map((i) => `hedge: ${i.claim}`),
  });

  const constraints = grounding.issues.filter((i) => i.kind === "constraint-violation");
  results.push({
    invariantId: "constraint-compliance",
    passed: constraints.length === 0,
    violations: constraints.map((i) => i.constraint),
  });

  const authority = grounding.issues.filter((i) => i.kind === "missing-authority-state");
  results.push({
    invariantId: "authority-respect",
    passed: authority.length === 0,
    violations: authority.map((i) => i.authority),
  });

  return results;
}

export function allInvariantsPassed(results: InvariantEvaluationResult[]): boolean {
  return results.every((r) => r.passed);
}
