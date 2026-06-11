/**
 * Runtime policy config for intel grounding — loaded from CoAgenticModel registry
 * via GET /api/agent-evolution/agents/:id/production.
 */

export type PolicyDocument = {
  rules?: string[];
  thresholds?: Record<string, number>;
  requiresGroundingValidation?: boolean;
  rejectUncitedActions?: boolean;
};

export type AgentPolicyBundle = {
  agentId: string;
  version: string;
  releaseId?: string;
  policies: Record<string, PolicyDocument>;
  systemPrompt?: string;
  outputSchema?: string;
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
  return (bundle.policies["attribution.json"]?.rules ?? []).filter((r) => r.trim().length > 0);
}

export async function fetchProductionAgentBundle(
  agentId = "intel-interpreter"
): Promise<AgentPolicyBundle | undefined> {
  try {
    const response = await fetch(`/api/agent-evolution/agents/${agentId}/production`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      bundle?: AgentPolicyBundle & { manifest?: { moduleEntrypoint?: string } };
    };
    const bundle = body.bundle;
    if (!bundle) return undefined;
    return {
      agentId: bundle.agentId,
      version: bundle.version,
      releaseId: bundle.releaseId,
      policies: bundle.policies,
      systemPrompt: bundle.systemPrompt,
      outputSchema: bundle.outputSchema,
      moduleEntrypoint: bundle.moduleEntrypoint ?? bundle.manifest?.moduleEntrypoint,
    };
  } catch {
    return undefined;
  }
}

export function mergeConstraints(
  base: string[],
  registryRules: string[]
): string[] {
  const seen = new Set(base.map((c) => c.trim().toLowerCase()));
  const merged = [...base];
  for (const rule of registryRules) {
    const key = rule.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(rule);
    }
  }
  return merged;
}
