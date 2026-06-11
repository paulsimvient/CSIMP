import { validateGrounding } from "./grounding";
import {
  DEFAULT_GROUNDING_POLICY,
  groundingConfigFromBundle,
  type AgentPolicyBundle,
  type GroundingPolicyConfig,
} from "./groundingPolicy";
import type { LLMInterpretation, ScenarioPacket } from "./types";

export type PolicyShadowFixture = {
  id: string;
  packet: ScenarioPacket;
  interpretation: LLMInterpretation;
};

/** Fixed scenarios exercised under production vs candidate registry policy. */
export const POLICY_SHADOW_FIXTURES: PolicyShadowFixture[] = [
  {
    id: "grounded-monitoring",
    packet: {
      commanderIntent: "Protect Port A",
      observedFacts: [
        {
          id: "fact_uas_001",
          domain: "UAS",
          entity: "Port A",
          event: "Unidentified UAS near approach",
          time: "14:32",
          source: "coastal radar",
          confidence: "high",
          severity: "medium",
        },
        {
          id: "fact_cyber_001",
          domain: "cyber",
          entity: "Port A logistics",
          event: "Auth failures above threshold",
          time: "14:20",
          source: "siem",
          confidence: "high",
          severity: "high",
        },
      ],
      knownAssets: ["counter-uas-team"],
      knownAuthorities: {},
      constraints: [],
    },
    interpretation: {
      observedFactsUsed: ["fact_uas_001"],
      inferences: [
        {
          claim: "Possible pressure pattern near Port A",
          supportingFacts: ["fact_uas_001"],
          confidence: "medium",
          whyNotHigher: "Insufficient corroboration",
        },
      ],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [
        {
          id: "act_monitor",
          description: "Increase passive monitoring",
          rationale: "UAS activity may indicate surveillance",
          actionType: "observe",
          citedFacts: ["fact_uas_001"],
          citedInferences: [],
          confidence: "medium",
        },
      ],
    },
  },
  {
    id: "single-source-attribution",
    packet: {
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
      ],
      knownAssets: [],
      knownAuthorities: {},
      constraints: [],
    },
    interpretation: {
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
    },
  },
  {
    id: "hallucinated-fact",
    packet: {
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
      ],
      knownAssets: [],
      knownAuthorities: {},
      constraints: [],
    },
    interpretation: {
      observedFactsUsed: ["fact_uas_001", "fact_invented_999"],
      inferences: [],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [],
    },
  },
];

export type PolicyShadowMetrics = {
  schemaValid: boolean;
  groundingPassRate: number;
  hallucinatedFactIds: number;
  unsupportedActions: number;
  constraintViolations: number;
  confidenceInflation: number;
  fixtureResults: Array<{ id: string; valid: boolean; blockingIssues: number }>;
};

export function runPolicyShadowMetrics(
  policy: GroundingPolicyConfig = DEFAULT_GROUNDING_POLICY,
  fixtures: PolicyShadowFixture[] = POLICY_SHADOW_FIXTURES
): PolicyShadowMetrics {
  const fixtureResults: PolicyShadowMetrics["fixtureResults"] = [];
  let hallucinatedFactIds = 0;
  let unsupportedActions = 0;
  let constraintViolations = 0;
  let confidenceInflation = 0;
  let passed = 0;

  for (const fixture of fixtures) {
    const result = validateGrounding(fixture.packet, fixture.interpretation, policy);
    if (result.valid) passed += 1;

    for (const issue of result.issues) {
      if (issue.kind === "hallucinated-fact-id") hallucinatedFactIds += 1;
      if (issue.kind === "unsupported-action") unsupportedActions += 1;
      if (issue.kind === "constraint-violation") constraintViolations += 1;
      if (issue.kind === "confidence-exceeds-evidence") confidenceInflation += 0.02;
    }

    fixtureResults.push({
      id: fixture.id,
      valid: result.valid,
      blockingIssues: result.blockingIssues,
    });
  }

  const total = fixtures.length || 1;
  return {
    schemaValid: passed === total,
    groundingPassRate: passed / total,
    hallucinatedFactIds,
    unsupportedActions,
    constraintViolations,
    confidenceInflation,
    fixtureResults,
  };
}

export function runPolicyShadowMetricsFromBundle(
  bundle: AgentPolicyBundle,
  fixtures?: PolicyShadowFixture[]
): PolicyShadowMetrics {
  return runPolicyShadowMetrics(groundingConfigFromBundle(bundle), fixtures);
}
