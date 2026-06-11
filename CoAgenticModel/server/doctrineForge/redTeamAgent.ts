/**
 * Red-team agent — attacks operational assumptions, not infrastructure.
 * Coevolves with blue doctrine by generating adversarial scenario challenges.
 */

import { randomUUID } from "node:crypto";
import type {
  AdversarialSignal,
  CausalTrace,
  ForgedScenario,
  RedTeamChallenge,
  ScenarioMutation,
} from "../../src/types/doctrine";
import type { ScenarioPacket } from "../../../src/intel/types";
import { forgeScenariosFromFailureClass } from "../../../src/intel/scenarioForge";

const ASSUMPTION_ATTACKS: Array<{
  id: string;
  matches: RegExp;
  assumption: string;
  signalType: string;
  description: string;
  mutatorHint: string;
}> = [
  {
    id: "implicit-relay",
    matches: /relay|comms|c2|connectivity/i,
    assumption: "Command relay remains available during concurrent actions",
    signalType: "degraded-infrastructure",
    description: "Primary relay unavailable during proposed action window",
    mutatorHint: "degraded-communications",
  },
  {
    id: "single-source-attribution",
    matches: /attribution|adversary|hedge|confidence/i,
    assumption: "Single high-confidence sensor supports attribution",
    signalType: "false-attribution-signal",
    description: "Secondary source contradicts primary attribution assessment",
    mutatorHint: "conflicting-sensor-reports",
  },
  {
    id: "authority-implicit",
    matches: /authority|approval|unsupport|missing-authority/i,
    assumption: "Required authority remains authorized throughout execution",
    signalType: "authority-restriction",
    description: "Authority profile tightened mid-scenario",
    mutatorHint: "authority-restriction-midcourse",
  },
  {
    id: "stale-logistics",
    matches: /logistics|asset|feasib|unsat|matrix/i,
    assumption: "Logistics state remains fresh and assets remain available",
    signalType: "stale-logistics",
    description: "Logistics asset marked unavailable or stale beyond threshold",
    mutatorHint: "degraded-communications",
  },
];

function metaToMutation(
  meta: {
    mutationId: string;
    baseScenarioId: string;
    mutator: string;
    label: string;
    difficultyScore: number;
  },
  baseScenarioId: string,
  adversarialSignals: AdversarialSignal[]
): ScenarioMutation {
  return {
    mutationId: meta.mutationId,
    baseScenarioId,
    mutator: meta.mutator,
    label: meta.label,
    changedAssumptions: [],
    injectedAmbiguities: [
      { id: meta.mutationId, description: meta.label, affectedFactIds: [] },
    ],
    adversarialSignals,
    expectedInvariantChecks: [
      "fact-provenance",
      "grounding-citation",
      "attribution-discipline",
      "authority-respect",
    ],
    difficultyScore: meta.difficultyScore,
    synthetic: true,
  };
}

function selectAttacks(trace?: CausalTrace): typeof ASSUMPTION_ATTACKS {
  if (!trace) return ASSUMPTION_ATTACKS;
  const text = `${trace.failureClass} ${trace.minimalCounterexample} ${trace.summary}`;
  const matched = ASSUMPTION_ATTACKS.filter((a) => a.matches.test(text));
  return matched.length > 0 ? matched : ASSUMPTION_ATTACKS.slice(0, 2);
}

/** Generate a red-team challenge from base scenario + optional causal trace. */
export function runRedTeamChallenge(input: {
  baseScenarioId: string;
  packet: ScenarioPacket;
  causalTrace?: CausalTrace;
}): RedTeamChallenge {
  const attacks = selectAttacks(input.causalTrace);
  const primary = attacks[0]!;
  const failureClass = input.causalTrace?.failureClass ?? "assumption-attack";

  const forged = forgeScenariosFromFailureClass(
    input.packet,
    input.baseScenarioId,
    failureClass
  );

  const adversarialSignals: AdversarialSignal[] = attacks.map((attack) => ({
    id: attack.id,
    signalType: attack.signalType,
    description: attack.description,
  }));

  const forgedScenarios: ForgedScenario[] = forged.map(({ scenarioId, packet, meta }) => ({
    scenarioId,
    packet,
    mutation: metaToMutation(meta, input.baseScenarioId, adversarialSignals),
  }));

  const difficultyScore =
    forgedScenarios.reduce((sum, s) => sum + s.mutation.difficultyScore, 0) /
    Math.max(1, forgedScenarios.length);

  return {
    challengeId: `red-${randomUUID().slice(0, 10)}`,
    baseScenarioId: input.baseScenarioId,
    assumptionAttacked: primary.assumption,
    adversarialSignals,
    forgedScenarios,
    difficultyScore,
  };
}
