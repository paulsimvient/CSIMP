import { createHash, randomUUID } from "node:crypto";
import type {
  CapabilityPassport,
  DoctrineFossil,
  InvariantResult,
  MissionEnvelope,
  ReplayResult,
} from "../../src/types/doctrine";
import type { LLMInterpretation, ScenarioPacket } from "../../../src/intel/types";
import { evaluateOperationalInvariants } from "../../../src/intel/invariantEvaluator";
import { classifyMissionEnvelope } from "../../../src/intel/missionEnvelope";
import { groundingConfigFromBundle } from "../../../src/intel/groundingPolicy";
import type { AgentPolicyBundle } from "../../src/types/policy";

export type PassportBuildInput = {
  agentId: string;
  agentVersion: string;
  parentVersion: string;
  rollbackTarget: string;
  releaseId?: string;
  fossils: DoctrineFossil[];
  replayScenarios: Array<{
    scenarioId: string;
    mutationId: string;
    packet: ScenarioPacket;
    interpretation: LLMInterpretation;
  }>;
  bundle?: AgentPolicyBundle;
  triggeringEvidence?: string[];
  mutationDescription?: string;
  tournamentResults?: import("../../src/types/doctrine").TournamentResult[];
  mutationBudget?: import("../../src/types/doctrine").MutationBudget;
};

function hashPassport(payload: Omit<CapabilityPassport, "signature" | "passportId" | "issuedAt">): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function envelopeFromClassification(
  packet: ScenarioPacket,
  envelopeId: string
): MissionEnvelope {
  const classification = classifyMissionEnvelope(packet);
  return {
    envelopeId,
    label: classification.envelopeClass,
    validFor: {
      scenarioClasses: [classification.envelopeClass],
      domains: packet.observedFacts.some((f) => f.domain.toLowerCase() === "cyber")
        ? ["cyber"]
        : ["maritime"],
      authorityProfiles: Object.keys(packet.knownAuthorities ?? {}),
      confidenceRange: [0.5, 1] as [number, number],
    },
    invalidWhen: [],
    evidenceBundleId: envelopeId,
  };
}

export function buildCapabilityPassport(input: PassportBuildInput): CapabilityPassport {
  const policy = input.bundle ? groundingConfigFromBundle(input.bundle) : undefined;
  const replayResults: ReplayResult[] = [];
  const aggregateInvariants = new Map<string, InvariantResult>();

  for (const scenario of input.replayScenarios) {
    const invariantResults = evaluateOperationalInvariants(
      scenario.packet,
      scenario.interpretation,
      policy
    ).map((r) => ({
      invariantId: r.invariantId,
      passed: r.passed,
      violations: r.violations,
    }));

    const passed = invariantResults.every((r) => r.passed);
    const blockingIssues = invariantResults.reduce((n, r) => n + r.violations.length, 0);

    replayResults.push({
      scenarioId: scenario.scenarioId,
      mutationId: scenario.mutationId,
      passed,
      invariantResults,
      blockingIssues,
    });

    for (const result of invariantResults) {
      const existing = aggregateInvariants.get(result.invariantId);
      if (!existing) {
        aggregateInvariants.set(result.invariantId, { ...result });
      } else if (!result.passed) {
        existing.passed = false;
        existing.violations.push(...result.violations);
      }
    }
  }

  const worldsGenerated = input.replayScenarios.length;
  const worldsSurvived = replayResults.filter((r) => r.passed).length;

  const unresolvedRisks =
    worldsSurvived < worldsGenerated
      ? [
          {
            id: "forge-replay-gap",
            description: `${worldsGenerated - worldsSurvived} forged scenario(s) still fail invariant replay`,
            severity: "medium" as const,
          },
        ]
      : [];

  const payload = {
    releaseId: input.releaseId,
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    lineage: {
      agentId: input.agentId,
      lineageId: `${input.agentId}-lineage`,
      generation: 1,
      parentVersion: input.parentVersion,
    },
    parentVersion: input.parentVersion,
    mutationSummary: {
      layersChanged: ["policy" as const],
      filesChanged: 0,
      rulesAdded: 0,
      description: [
        input.mutationDescription ?? "Doctrine mutation from operational failure",
        input.mutationBudget ? `(trust tier: ${input.mutationBudget.trustTier})` : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    triggeringEvidence: input.triggeringEvidence ?? input.fossils.flatMap((f) => f.causalTrace.evidenceRefs),
    counterexamplesResolved: input.fossils.map((f) => f.causalTrace.minimalCounterexample),
    fossilIds: input.fossils.map((f) => f.fossilId),
    invariantResults: [...aggregateInvariants.values()],
    scenarioReplayResults: replayResults,
    adversarialTournamentResults: input.tournamentResults ?? [],
    newlySupportedMissionEnvelopes:
      input.replayScenarios.length > 0
        ? [envelopeFromClassification(input.replayScenarios[0]!.packet, `env-${input.agentVersion}`)]
        : [],
    degradedMissionEnvelopes: [],
    worldsSurvived,
    worldsGenerated,
    unresolvedRisks,
    rollbackTarget: input.rollbackTarget,
    reviewerApprovals: [],
  };

  const signature = hashPassport(payload);

  return {
    passportId: `passport-${randomUUID().slice(0, 10)}`,
    ...payload,
    signature,
    issuedAt: new Date().toISOString(),
  };
}

export function formatPassportSummary(passport: CapabilityPassport): string {
  const resolved = passport.counterexamplesResolved.length;
  const lines = [
    `Candidate ${passport.agentVersion} survived ${passport.worldsSurvived}/${passport.worldsGenerated} generated operational worlds.`,
    "",
    "Resolved:",
    ...passport.counterexamplesResolved.slice(0, 5).map((c) => `- ${c.slice(0, 120)}`),
    "",
    "Invariant replay:",
    ...passport.invariantResults.map(
      (r) => `- ${r.invariantId}: ${r.passed ? "pass" : `fail (${r.violations.length})`}`
    ),
  ];
  if (passport.adversarialTournamentResults.length > 0) {
    lines.push("", "Tournament:");
    for (const result of passport.adversarialTournamentResults) {
      lines.push(`- ${result.variantId} (${result.agentVersion}): ${result.wins}W/${result.losses}L`);
    }
  }
  if (passport.newlySupportedMissionEnvelopes.length > 0) {
    lines.push("", "New operating envelope:", `- ${passport.newlySupportedMissionEnvelopes[0]!.label}`);
  }
  if (passport.unresolvedRisks.length > 0) {
    lines.push("", "Known limitations:", `- ${passport.unresolvedRisks[0]!.description}`);
  }
  if (resolved === 0) {
    lines.push("", `(Passport signature: ${passport.signature.slice(0, 16)}…)`);
  }
  return lines.join("\n");
}
