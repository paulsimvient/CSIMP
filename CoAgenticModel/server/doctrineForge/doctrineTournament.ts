/**
 * Multi-variant doctrine tournament — competing policy variants on forged worlds.
 */

import { randomUUID } from "node:crypto";
import type {
  DoctrineVariant,
  TournamentResult,
  TournamentSession,
} from "../../src/types/doctrine";
import type { LLMInterpretation, ScenarioPacket } from "../../../src/intel/types";
import { evaluateOperationalInvariants } from "../../../src/intel/invariantEvaluator";
import { runPolicyShadowMetricsFromBundle } from "../../../src/intel/policyShadowEval";
import { groundingConfigFromBundle } from "../../../src/intel/groundingPolicy";
import type { AgentPolicyBundle } from "../../src/types/policy";
import { simulatePolicyBundle } from "../agentEvolution/simulatePolicy";
import type { PolicyChange } from "../../src/types/proposal";

export type TournamentInput = {
  agentId: string;
  baseVersion: string;
  baseBundle: AgentPolicyBundle;
  scenarios: Array<{ scenarioId: string; packet: ScenarioPacket }>;
  variants?: DoctrineVariant[];
  interpretation?: LLMInterpretation;
};

function defaultVariants(agentId: string, baseVersion: string): DoctrineVariant[] {
  const prefix = `policies/agents/${agentId}/`;
  const bump = (n: number) => {
    const m = baseVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return `${baseVersion}-t${n}`;
    return `${m[1]}.${m[2]}.${Number(m[3]) + n}`;
  };
  return [
    {
      variantId: "prod-baseline",
      label: "Production baseline",
      agentVersion: baseVersion,
      policyChanges: [],
    },
    {
      variantId: "strict-attribution",
      label: "Strict attribution corroboration",
      agentVersion: bump(1),
      policyChanges: [
        {
          path: `${prefix}attribution.json`,
          operation: "add-rule",
          rule: "Require corroboration from two independent sources before attribution claims.",
        },
      ],
    },
    {
      variantId: "strict-grounding",
      label: "Strict grounding citation",
      agentVersion: bump(2),
      policyChanges: [
        {
          path: `${prefix}grounding.json`,
          operation: "add-rule",
          rule: "Every candidate action must cite at least two observed fact IDs.",
        },
      ],
    },
  ];
}

function conservativeInterpretation(packet: ScenarioPacket): LLMInterpretation {
  const factId = packet.observedFacts[0]?.id ?? "fact_unknown";
  return {
    observedFactsUsed: [factId],
    inferences: [
      {
        claim: "Activity may require increased monitoring",
        supportingFacts: [factId],
        confidence: "medium",
        whyNotHigher: "Forged scenario — insufficient corroboration",
      },
    ],
    decisionPoints: [],
    assumptions: [],
    uncertainties: ["Synthetic tournament scenario"],
    candidateActions: [
      {
        id: "act_monitor",
        description: "Increase passive monitoring",
        rationale: "Conservative tournament replay",
        actionType: "observe",
        citedFacts: [factId],
        citedInferences: [],
        confidence: "medium",
      },
    ],
  };
}

export function runDoctrineTournament(input: TournamentInput): TournamentSession {
  const variants = input.variants ?? defaultVariants(input.agentId, input.baseVersion);
  const interpretation = input.interpretation ?? conservativeInterpretation(input.scenarios[0]?.packet ?? {
    commanderIntent: "",
    observedFacts: [],
    knownAssets: [],
    constraints: [],
  });

  const results: TournamentResult[] = variants.map((variant) => {
    const bundle =
      variant.policyChanges.length === 0
        ? input.baseBundle
        : simulatePolicyBundle(
            input.baseBundle,
            variant.policyChanges as PolicyChange[],
            variant.agentVersion
          );

    const policy = groundingConfigFromBundle(bundle);
    let wins = 0;
    let losses = 0;
    const unresolvedFailures: string[] = [];

    for (const scenario of input.scenarios) {
      const invariants = evaluateOperationalInvariants(
        scenario.packet,
        interpretation,
        policy
      );
      const passed = invariants.every((r) => r.passed);
      if (passed) wins += 1;
      else {
        losses += 1;
        unresolvedFailures.push(
          `${scenario.scenarioId}: ${invariants.filter((r) => !r.passed).map((r) => r.invariantId).join(", ")}`
        );
      }
    }

    const shadow = runPolicyShadowMetricsFromBundle(bundle);
    if (shadow.groundingPassRate < 0.5) {
      unresolvedFailures.push(`policy-shadow pass rate ${shadow.groundingPassRate.toFixed(2)}`);
    }

    return {
      variantId: variant.variantId,
      agentVersion: variant.agentVersion,
      wins,
      losses,
      unresolvedFailures,
    };
  });

  const winner = [...results].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.losses - b.losses;
  })[0];

  return {
    sessionId: `tournament-${randomUUID().slice(0, 10)}`,
    agentId: input.agentId,
    baseVersion: input.baseVersion,
    scenariosEvaluated: input.scenarios.length,
    results,
    winnerVariantId: winner?.losses === 0 || (winner && winner.wins >= winner.losses) ? winner.variantId : undefined,
    ranAt: new Date().toISOString(),
  };
}

export function rankTournamentResults(results: TournamentResult[]): TournamentResult[] {
  return [...results].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.unresolvedFailures.length - b.unresolvedFailures.length;
  });
}
