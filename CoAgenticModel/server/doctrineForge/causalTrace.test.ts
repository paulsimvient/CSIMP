import { describe, expect, it } from "vitest";
import { POLICY_SHADOW_FIXTURES } from "../../../src/intel/policyShadowEval";
import {
  buildCausalTrace,
  buildRegressionPredicate,
  classifyFailureClass,
  matchesRegressionPredicate,
} from "./causalTrace";

describe("causalTrace", () => {
  it("classifies hallucinated fact provenance failure", () => {
    const fixture = POLICY_SHADOW_FIXTURES.find((f) => f.id === "hallucinated-fact")!;
    const { trace, grounding } = buildCausalTrace({
      scenarioRef: fixture.id,
      packet: fixture.packet,
      interpretation: fixture.interpretation,
    });
    expect(grounding.valid).toBe(false);
    expect(trace.failureClass).toBe("hallucinated-fact-provenance");
    expect(trace.minimalCounterexample.length).toBeGreaterThan(10);
  });

  it("detects fossil regression when predicate matches", () => {
    const fixture = POLICY_SHADOW_FIXTURES.find((f) => f.id === "hallucinated-fact")!;
    const { trace } = buildCausalTrace({
      scenarioRef: fixture.id,
      packet: fixture.packet,
      interpretation: fixture.interpretation,
    });
    const predicate = buildRegressionPredicate(trace.failureClass, trace.groundingIssueKinds);
    expect(matchesRegressionPredicate(predicate, trace)).toBe(true);
    expect(classifyFailureClass({ valid: false, issues: [{ kind: "hallucinated-fact-id", id: "x" }], blockingIssues: 1, reviewIssues: 0, hasIssues: true, usableForPlanning: false, evidenceConflicts: [], unusedFacts: [], validatedActionIds: [], validatedDecisionPointIds: [] })).toBe("hallucinated-fact-provenance");
  });
});
