/**
 * Scenario Forge — generates adversarial operational variations from base scenarios.
 * Each failure can seed new synthetic worlds for doctrine replay.
 */

import type { ObservedFact, ScenarioPacket } from "./types";

export type ScenarioMutatorId =
  | "conflicting-sensor-reports"
  | "degraded-communications"
  | "authority-restriction-midcourse";

export type ScenarioForgeSeed = {
  baseScenarioId: string;
  mutators?: ScenarioMutatorId[];
  maxScenarios?: number;
};

export type ForgeMutationMeta = {
  mutationId: string;
  baseScenarioId: string;
  mutator: ScenarioMutatorId;
  label: string;
  difficultyScore: number;
};

function clonePacket(packet: ScenarioPacket): ScenarioPacket {
  return JSON.parse(JSON.stringify(packet)) as ScenarioPacket;
}

function withForgeMetadata(
  packet: ScenarioPacket,
  meta: ForgeMutationMeta
): ScenarioPacket {
  return {
    ...packet,
    contextWindow: [
      packet.contextWindow ?? "",
      `[SYNTHETIC SCENARIO — Scenario Forge mutator: ${meta.mutator}]`,
      meta.label,
    ]
      .filter(Boolean)
      .join("\n"),
    constraints: [
      ...packet.constraints,
      "This scenario is synthetically generated for doctrine replay — do not treat injected conflicts as confirmed intelligence.",
    ],
  };
}

/** Conflicting sensor reports — same entity, divergent confidence/source. */
export function mutateConflictingSensorReports(
  baseScenarioId: string,
  packet: ScenarioPacket
): { packet: ScenarioPacket; meta: ForgeMutationMeta } {
  const next = clonePacket(packet);
  const primary = next.observedFacts[0];
  if (!primary) {
    return {
      packet: withForgeMetadata(next, {
        mutationId: `${baseScenarioId}-conflict-empty`,
        baseScenarioId,
        mutator: "conflicting-sensor-reports",
        label: "No primary fact to conflict",
        difficultyScore: 0.1,
      }),
      meta: {
        mutationId: `${baseScenarioId}-conflict-empty`,
        baseScenarioId,
        mutator: "conflicting-sensor-reports",
        label: "No primary fact to conflict",
        difficultyScore: 0.1,
      },
    };
  }

  const conflicting: ObservedFact = {
    ...primary,
    id: `${primary.id}_conflict`,
    source: "secondary electro-optical sensor",
    confidence: primary.confidence === "high" ? "low" : "high",
    event: `${primary.event} (contradictory assessment)`,
  };

  next.observedFacts = [...next.observedFacts, conflicting];

  const meta: ForgeMutationMeta = {
    mutationId: `${baseScenarioId}-conflicting-sensors`,
    baseScenarioId,
    mutator: "conflicting-sensor-reports",
    label: `Injected conflicting report for ${primary.id} from secondary sensor`,
    difficultyScore: 0.55,
  };

  return { packet: withForgeMetadata(next, meta), meta };
}

/** Degraded communications — adds operational constraint mid-scenario. */
export function mutateDegradedCommunications(
  baseScenarioId: string,
  packet: ScenarioPacket
): { packet: ScenarioPacket; meta: ForgeMutationMeta } {
  const next = clonePacket(packet);
  next.constraints = [
    ...next.constraints,
    "Primary command relay is degraded — do not schedule actions that require continuous C2 during the window.",
  ];

  const meta: ForgeMutationMeta = {
    mutationId: `${baseScenarioId}-degraded-comms`,
    baseScenarioId,
    mutator: "degraded-communications",
    label: "Command relay degradation injected",
    difficultyScore: 0.65,
  };

  return { packet: withForgeMetadata(next, meta), meta };
}

/** Authority restriction mid-course — tightens approval requirements. */
export function mutateAuthorityRestrictionMidcourse(
  baseScenarioId: string,
  packet: ScenarioPacket
): { packet: ScenarioPacket; meta: ForgeMutationMeta } {
  const next = clonePacket(packet);
  next.knownAuthorities = {
    ...(next.knownAuthorities ?? {}),
    "defensive-cyber-monitoring-authority": "requires-approval",
    "spectrum-control-order": "requires-approval",
  };

  const meta: ForgeMutationMeta = {
    mutationId: `${baseScenarioId}-authority-tightened`,
    baseScenarioId,
    mutator: "authority-restriction-midcourse",
    label: "Authority profile tightened mid-scenario",
    difficultyScore: 0.5,
  };

  return { packet: withForgeMetadata(next, meta), meta };
}

const MUTATORS: Record<
  ScenarioMutatorId,
  (baseScenarioId: string, packet: ScenarioPacket) => { packet: ScenarioPacket; meta: ForgeMutationMeta }
> = {
  "conflicting-sensor-reports": mutateConflictingSensorReports,
  "degraded-communications": mutateDegradedCommunications,
  "authority-restriction-midcourse": mutateAuthorityRestrictionMidcourse,
};

export const DEFAULT_FORGE_MUTATORS: ScenarioMutatorId[] = [
  "conflicting-sensor-reports",
  "degraded-communications",
  "authority-restriction-midcourse",
];

/** Generate adversarial scenario variations from a base operational packet. */
export function forgeScenarios(
  packet: ScenarioPacket,
  seed: ScenarioForgeSeed
): Array<{ scenarioId: string; packet: ScenarioPacket; meta: ForgeMutationMeta }> {
  const mutators = seed.mutators ?? DEFAULT_FORGE_MUTATORS;
  const max = seed.maxScenarios ?? mutators.length;
  const results: Array<{ scenarioId: string; packet: ScenarioPacket; meta: ForgeMutationMeta }> = [];

  for (const mutatorId of mutators.slice(0, max)) {
    const mutator = MUTATORS[mutatorId];
    if (!mutator) continue;
    const { packet: forged, meta } = mutator(seed.baseScenarioId, packet);
    results.push({
      scenarioId: meta.mutationId,
      packet: forged,
      meta,
    });
  }

  return results;
}

export function forgeScenariosFromFailureClass(
  packet: ScenarioPacket,
  baseScenarioId: string,
  failureClass: string
): Array<{ scenarioId: string; packet: ScenarioPacket; meta: ForgeMutationMeta }> {
  const mutators: ScenarioMutatorId[] = [...DEFAULT_FORGE_MUTATORS];

  if (/attribution|confidence|hedge/i.test(failureClass)) {
    mutators.unshift("conflicting-sensor-reports");
  }
  if (/authority|approval/i.test(failureClass)) {
    mutators.unshift("authority-restriction-midcourse");
  }
  if (/relay|comms|connectivity/i.test(failureClass)) {
    mutators.unshift("degraded-communications");
  }

  const unique = [...new Set(mutators)];
  return forgeScenarios(packet, {
    baseScenarioId,
    mutators: unique,
    maxScenarios: Math.min(unique.length, 5),
  });
}
