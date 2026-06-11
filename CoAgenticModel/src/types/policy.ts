import type { AgentDefinition } from "./agent";

export type PolicyDocument = {
  agentId?: string;
  version?: string;
  rules?: string[];
  thresholds?: Record<string, number>;
  requiresGroundingValidation?: boolean;
  rejectUncitedActions?: boolean;
  notes?: string;
};

/** Loaded registry package for runtime intel + grounding. */
export type AgentPolicyBundle = {
  agentId: string;
  version: string;
  releaseId?: string;
  manifest: AgentDefinition;
  /** Keyed by policy filename e.g. "attribution.json" */
  policies: Record<string, PolicyDocument>;
  systemPrompt?: string;
  outputSchema?: string;
  /** Resolved Tier B module path (CoAgenticModel-relative). */
  moduleEntrypoint?: string;
};

export type GroundingPolicyConfig = {
  forbiddenHedgeWords: string[];
  minCitedFactsPerAction: number;
  rejectUncitedActions: boolean;
  attributionRules: string[];
  requiresGroundingValidation: boolean;
};

export const DEFAULT_GROUNDING_POLICY: GroundingPolicyConfig = {
  forbiddenHedgeWords: [
    "proves",
    "confirms",
    "shows",
    "demonstrates",
    "establishes",
    "certainly",
    "definitely",
    "confirmed that adversary",
    "shows adversary",
    "shows the adversary",
    "confirms the attack",
    "proves the attack",
  ],
  minCitedFactsPerAction: 1,
  rejectUncitedActions: true,
  attributionRules: [],
  requiresGroundingValidation: true,
};

export function groundingConfigFromBundle(bundle: AgentPolicyBundle): GroundingPolicyConfig {
  const attribution = bundle.policies["attribution.json"];
  const grounding = bundle.policies["grounding.json"];
  const thresholds = attribution?.thresholds ?? {};

  return {
    forbiddenHedgeWords: DEFAULT_GROUNDING_POLICY.forbiddenHedgeWords,
    minCitedFactsPerAction: Math.max(
      1,
      Number(thresholds.minCitedFactsPerAction ?? DEFAULT_GROUNDING_POLICY.minCitedFactsPerAction)
    ),
    rejectUncitedActions:
      grounding?.rejectUncitedActions ?? DEFAULT_GROUNDING_POLICY.rejectUncitedActions,
    attributionRules: attribution?.rules ?? [],
    requiresGroundingValidation:
      grounding?.requiresGroundingValidation ??
      DEFAULT_GROUNDING_POLICY.requiresGroundingValidation,
  };
}

export function constraintsFromBundle(bundle: AgentPolicyBundle): string[] {
  const rules = bundle.policies["attribution.json"]?.rules ?? [];
  return rules.filter((rule) => rule.trim().length > 0);
}
