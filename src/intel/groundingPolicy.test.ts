import { describe, expect, it } from "vitest";
import { validateGrounding } from "./grounding";
import type { LLMInterpretation, ScenarioPacket } from "./types";
import type { GroundingPolicyConfig } from "./groundingPolicy";

function basePacket(): ScenarioPacket {
  return {
    commanderIntent: "Protect Port A",
    observedFacts: [
      {
        id: "fact_uas_001",
        domain: "UAS",
        entity: "Port A",
        event: "Unidentified UAS",
        time: "14:32",
        source: "coastal radar",
        confidence: "high",
        severity: "medium",
      },
      {
        id: "fact_cyber_001",
        domain: "cyber",
        entity: "Port A logistics",
        event: "Auth failures",
        time: "14:20",
        source: "siem",
        confidence: "high",
        severity: "high",
      },
    ],
    knownAssets: ["counter-uas-team"],
    knownAuthorities: {},
    constraints: [],
  };
}

describe("registry-driven grounding policy", () => {
  it("blocks high-confidence attribution from a single source per registry rule", () => {
    const policy: GroundingPolicyConfig = {
      forbiddenHedgeWords: [],
      minCitedFactsPerAction: 1,
      rejectUncitedActions: true,
      requiresGroundingValidation: true,
      attributionRules: [
        "Require corroboration from two independent sources before attribution claims.",
      ],
    };

    const interpretation: LLMInterpretation = {
      observedFactsUsed: ["fact_uas_001"],
      inferences: [
        {
          claim: "The adversary is conducting coordinated surveillance",
          supportingFacts: ["fact_uas_001"],
          confidence: "high",
        },
      ],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [],
    };

    const result = validateGrounding(basePacket(), interpretation, policy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === "constraint-violation")).toBe(true);
  });

  it("requires minCitedFactsPerAction from registry thresholds", () => {
    const policy: GroundingPolicyConfig = {
      forbiddenHedgeWords: [],
      minCitedFactsPerAction: 2,
      rejectUncitedActions: true,
      requiresGroundingValidation: true,
      attributionRules: [],
    };

    const interpretation: LLMInterpretation = {
      observedFactsUsed: ["fact_uas_001"],
      inferences: [],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [
        {
          id: "act_001",
          description: "Increase passive monitoring",
          rationale: "UAS activity warrants observation",
          actionType: "observe",
          citedFacts: ["fact_uas_001"],
          citedInferences: [],
          confidence: "medium",
        },
      ],
    };

    const result = validateGrounding(basePacket(), interpretation, policy);
    expect(result.validatedActionIds).not.toContain("act_001");
    expect(
      result.issues.some(
        (i) => i.kind === "unsupported-action" && i.actionId === "act_001"
      )
    ).toBe(true);
  });
});
