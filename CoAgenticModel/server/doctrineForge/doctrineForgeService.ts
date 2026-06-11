import { randomUUID } from "node:crypto";
import type {
  CapabilityPassport,
  DoctrineFossil,
  EnvelopeRouteRecord,
  ForgedScenario,
  LineageTrustRecord,
  MutationBudget,
  OperationalFailureInput,
  RecordFailureResult,
  RedTeamChallenge,
  ScenarioMutation,
  TournamentSession,
} from "../../src/types/doctrine";
import type { LLMInterpretation, ScenarioPacket } from "../../../src/intel/types";
import { extractCoaCounterexample } from "../../../src/coa/coaCounterexample";
import { classifyMissionEnvelope } from "../../../src/intel/missionEnvelope";
import { forgeScenariosFromFailureClass } from "../../../src/intel/scenarioForge";
import { POLICY_SHADOW_FIXTURES } from "../../../src/intel/policyShadowEval";
import {
  buildCausalTrace,
  buildRegressionPredicate,
  matchesRegressionPredicate,
} from "./causalTrace";
import { buildCapabilityPassport, formatPassportSummary, type PassportBuildInput } from "./passportBuilder";
import { createFileFossilStore, type FossilStore } from "./fossilStore";
import { createFilePassportStore, type PassportStore } from "./passportStore";
import { createFileEnvelopeRouteStore, type EnvelopeRouteStore } from "./envelopeStore";
import { createFileLineageTrustStore, type LineageTrustStore } from "./lineageTrustStore";
import { runRedTeamChallenge } from "./redTeamAgent";
import { runDoctrineTournament } from "./doctrineTournament";
import {
  defaultLineageTrust,
  evaluateProposalAgainstBudget,
  mutationBudgetForTrust,
  trustTierFromLineage,
} from "./mutationBudget";
import { loadPolicyBundle } from "../agentEvolution/loadPolicyBundle";
import type { AgentEvolutionService } from "../agentEvolution/service";
import type { AgentPatchProposal } from "../../src/types/proposal";

export type DoctrineForgeServiceOptions = {
  coda2Root: string;
  dataDir?: string;
};

export type ForgePassportInput = {
  agentId: string;
  agentVersion: string;
  parentVersion: string;
  rollbackTarget: string;
  fossilIds?: string[];
  releaseId?: string;
  /** Interpretation to replay against forged scenarios (defaults to production-safe stub). */
  candidateInterpretation?: LLMInterpretation;
};

export class DoctrineForgeService {
  private readonly coda2Root: string;
  private readonly dataDir: string;
  readonly fossils: FossilStore;
  readonly passports: PassportStore;
  readonly envelopeRoutes: EnvelopeRouteStore;
  readonly lineageTrust: LineageTrustStore;

  constructor(options: DoctrineForgeServiceOptions) {
    this.dataDir =
      options.dataDir ?? `${options.coda2Root}/CoAgenticModel/.data/doctrine-forge`;
    this.coda2Root = options.coda2Root;
    this.fossils = createFileFossilStore(this.dataDir);
    this.passports = createFilePassportStore(this.dataDir);
    this.envelopeRoutes = createFileEnvelopeRouteStore(this.dataDir);
    this.lineageTrust = createFileLineageTrustStore(this.dataDir);
  }

  async listFossils(): Promise<DoctrineFossil[]> {
    return this.fossils.list();
  }

  async getPassport(passportId: string): Promise<CapabilityPassport | undefined> {
    return this.passports.get(passportId);
  }

  /** Record an operational failure → causal trace → fossil → forged scenarios. */
  async recordOperationalFailure(input: OperationalFailureInput): Promise<RecordFailureResult> {
    const packet = input.scenarioPacket as ScenarioPacket;
    const interpretation = input.interpretation as LLMInterpretation;

    const { trace, grounding } = buildCausalTrace({
      scenarioRef: input.scenarioRef,
      packet,
      interpretation,
      evidenceRefs: input.evidenceRefs,
    });

    const forged = this.buildForgedScenarios(
      packet,
      input.scenarioRef,
      trace.failureClass
    );

    const fossil: DoctrineFossil = {
      fossilId: `fossil-${randomUUID().slice(0, 10)}`,
      firstObservedAt: trace.observedAt,
      scenarioRef: input.scenarioRef,
      failureClass: trace.failureClass,
      causalTrace: trace,
      prohibitedRegressionPredicate: buildRegressionPredicate(
        trace.failureClass,
        trace.groundingIssueKinds
      ),
      derivedScenarioIds: forged.map((f) => f.scenarioId),
      agentId: input.agentId,
    };

    await this.fossils.save(fossil);

    return { fossil, causalTrace: trace, forgedScenarios: forged };
  }

  /** Demo seed: hallucinated fact ID from policy shadow fixtures. */
  async recordDemoFailure(agentId = "intel-interpreter"): Promise<RecordFailureResult> {
    const fixture = POLICY_SHADOW_FIXTURES.find((f) => f.id === "hallucinated-fact");
    if (!fixture) {
      throw new Error("Demo fixture single-source-attribution not found");
    }
    return this.recordOperationalFailure({
      agentId,
      scenarioRef: fixture.id,
      scenarioPacket: fixture.packet,
      interpretation: fixture.interpretation,
      evidenceRefs: ["doctrine-forge-demo"],
    });
  }

  async forgeFromPacket(input: {
    baseScenarioId: string;
    packet: ScenarioPacket;
    failureClass?: string;
  }): Promise<ForgedScenario[]> {
    return this.buildForgedScenarios(
      input.packet,
      input.baseScenarioId,
      input.failureClass ?? "grounding-validation-failure"
    );
  }

  async runRedTeam(input: {
    baseScenarioId: string;
    packet: ScenarioPacket;
    fossilId?: string;
  }): Promise<RedTeamChallenge> {
    let causalTrace = undefined as RecordFailureResult["causalTrace"] | undefined;
    if (input.fossilId) {
      const fossil = await this.fossils.get(input.fossilId);
      causalTrace = fossil?.causalTrace;
    }
    return runRedTeamChallenge({
      baseScenarioId: input.baseScenarioId,
      packet: input.packet,
      causalTrace,
    });
  }

  async runTournament(input: {
    agentId: string;
    baseVersion: string;
    fossilIds?: string[];
  }): Promise<TournamentSession> {
    const baseBundle = await loadPolicyBundle(this.coda2Root, input.agentId, input.baseVersion);
    const fossils = await this.fossils.list();
    const selected =
      input.fossilIds && input.fossilIds.length > 0
        ? fossils.filter((f) => input.fossilIds!.includes(f.fossilId))
        : fossils.filter((f) => f.agentId === input.agentId).slice(0, 3);

    const scenarios: Array<{ scenarioId: string; packet: ScenarioPacket }> = [];
    for (const fossil of selected) {
      for (const scenarioId of fossil.derivedScenarioIds) {
        const forged = await this.resolveForgedScenario(fossil, scenarioId);
        if (forged) {
          scenarios.push({
            scenarioId: forged.scenarioId,
            packet: forged.packet as ScenarioPacket,
          });
        }
      }
    }

    if (scenarios.length === 0) {
      const fixture = POLICY_SHADOW_FIXTURES[0]!;
      scenarios.push({ scenarioId: fixture.id, packet: fixture.packet });
    }

    return runDoctrineTournament({
      agentId: input.agentId,
      baseVersion: input.baseVersion,
      baseBundle,
      scenarios,
    });
  }

  async recordCoaFailure(input: {
    agentId: string;
    coaRef?: string;
    blockers: string[];
    status?: "unsat" | "error" | "infeasible";
    scenarioPacket: ScenarioPacket;
  }): Promise<RecordFailureResult> {
    const counterexample = extractCoaCounterexample({
      coaRef: input.coaRef,
      blockers: input.blockers,
      status: input.status,
    });

    const interpretation: LLMInterpretation = {
      observedFactsUsed: input.scenarioPacket.observedFacts.map((f) => f.id).slice(0, 1),
      inferences: [
        {
          claim: counterexample.generalizedDoctrine,
          supportingFacts: input.scenarioPacket.observedFacts.map((f) => f.id).slice(0, 1),
          confidence: "medium",
        },
      ],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [counterexample.minimalExplanation],
      candidateActions: [],
    };

    return this.recordOperationalFailure({
      agentId: input.agentId,
      scenarioRef: input.coaRef ?? counterexample.counterexampleId,
      scenarioPacket: input.scenarioPacket,
      interpretation,
      evidenceRefs: [counterexample.counterexampleId, counterexample.failureClass],
    });
  }

  async getMutationBudget(agentId: string): Promise<MutationBudget> {
    const trust =
      (await this.lineageTrust.get(agentId)) ?? defaultLineageTrust(agentId);
    const tier = trustTierFromLineage(trust);
    return mutationBudgetForTrust(agentId, tier, trust.lineageId);
  }

  evaluateProposalBudget(proposal: AgentPatchProposal, budget: MutationBudget) {
    return evaluateProposalAgainstBudget(proposal, budget);
  }

  async recordPassportIssued(agentId: string): Promise<LineageTrustRecord> {
    const current = (await this.lineageTrust.get(agentId)) ?? defaultLineageTrust(agentId);
    const next: LineageTrustRecord = {
      ...current,
      passportsIssued: current.passportsIssued + 1,
      trustTier: trustTierFromLineage({
        ...current,
        passportsIssued: current.passportsIssued + 1,
      }),
    };
    await this.lineageTrust.save(next);
    return next;
  }

  async getEnvelopeRoutes(agentId: string): Promise<EnvelopeRouteRecord | undefined> {
    return this.envelopeRoutes.get(agentId);
  }

  async resolveEnvelopeVersion(
    agentId: string,
    envelopeClass: string,
    evolutionService: AgentEvolutionService
  ): Promise<{ version: string; route?: EnvelopeRouteRecord["routes"][number] }> {
    const routes = await this.envelopeRoutes.get(agentId);
    const defaultVersion =
      routes?.defaultVersion ?? (await evolutionService.resolveProductionVersion(agentId)) ?? "1.0.0";
    const match = routes?.routes.find((r) => r.envelopeClass === envelopeClass);
    if (match) return { version: match.version, route: match };
    return { version: defaultVersion };
  }

  async registerEnvelopeFromPassport(passport: CapabilityPassport): Promise<EnvelopeRouteRecord> {
    const envelope = passport.newlySupportedMissionEnvelopes[0];
    if (!envelope) {
      throw new Error("Passport has no mission envelope to register");
    }

    const existing =
      (await this.envelopeRoutes.get(passport.agentId)) ??
      ({
        agentId: passport.agentId,
        defaultVersion: passport.parentVersion,
        routes: [],
        updatedAt: new Date().toISOString(),
      } satisfies EnvelopeRouteRecord);

    const nextRoutes = existing.routes.filter((r) => r.envelopeClass !== envelope.label);
    nextRoutes.push({
      envelopeClass: envelope.label,
      version: passport.agentVersion,
      passportId: passport.passportId,
      label: envelope.label,
    });

    const record: EnvelopeRouteRecord = {
      ...existing,
      routes: nextRoutes,
      updatedAt: new Date().toISOString(),
    };
    await this.envelopeRoutes.save(record);
    return record;
  }

  async buildPassport(input: ForgePassportInput & { runTournament?: boolean }): Promise<{
    passport: CapabilityPassport;
    summary: string;
    regressionRejected: boolean;
    tournament?: TournamentSession;
  }> {
    const allFossils = await this.fossils.list();
    const selected =
      input.fossilIds && input.fossilIds.length > 0
        ? allFossils.filter((f) => input.fossilIds!.includes(f.fossilId))
        : allFossils.filter((f) => f.agentId === input.agentId).slice(0, 5);

    const bundle = await loadPolicyBundle(
      this.coda2Root,
      input.agentId,
      input.parentVersion
    ).catch(() => undefined);

    const replayScenarios: PassportBuildInput["replayScenarios"] = [];

    for (const fossil of selected) {
      for (const scenarioId of fossil.derivedScenarioIds) {
        const forged = await this.resolveForgedScenario(fossil, scenarioId);
        if (!forged) continue;
        const interpretation =
          input.candidateInterpretation ??
          this.conservativeInterpretation(forged.packet as ScenarioPacket);
        replayScenarios.push({
          scenarioId: forged.scenarioId,
          mutationId: forged.mutation.mutationId,
          packet: forged.packet as ScenarioPacket,
          interpretation,
        });
      }
    }

    const tournament = input.runTournament
      ? await this.runTournament({
          agentId: input.agentId,
          baseVersion: input.parentVersion,
          fossilIds: input.fossilIds,
        })
      : undefined;

    const budget = await this.getMutationBudget(input.agentId);

    const passport = buildCapabilityPassport({
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      parentVersion: input.parentVersion,
      rollbackTarget: input.rollbackTarget,
      releaseId: input.releaseId,
      fossils: selected,
      replayScenarios,
      bundle,
      mutationDescription: `Doctrine forge passport for ${input.agentVersion}`,
      tournamentResults: tournament?.results,
      mutationBudget: budget,
    });

    const regressionRejected = await this.checkRegressionAgainstFossils(
      passport,
      input.candidateInterpretation
    );

    if (regressionRejected) {
      passport.unresolvedRisks.push({
        id: "fossil-regression",
        description: "Candidate reintroduces an extinct failure class from the fossil record",
        severity: "high",
      });
    }

    await this.passports.save(passport);
    await this.recordPassportIssued(input.agentId);

    return {
      passport,
      summary: formatPassportSummary(passport),
      regressionRejected,
      tournament,
    };
  }

  async checkRegressionAgainstFossils(
    passport: CapabilityPassport,
    candidateInterpretation?: LLMInterpretation
  ): Promise<boolean> {
    if (!candidateInterpretation) return false;

    const fossils = await this.fossils.list();
    const related = fossils.filter((f) => passport.fossilIds.includes(f.fossilId));

    for (const fossil of related) {
      const fixture = POLICY_SHADOW_FIXTURES.find((f) => f.id === fossil.scenarioRef);
      if (!fixture) continue;

      const { trace, grounding } = buildCausalTrace({
        scenarioRef: fossil.scenarioRef,
        packet: fixture.packet,
        interpretation: candidateInterpretation,
      });

      if (
        !grounding.valid &&
        matchesRegressionPredicate(fossil.prohibitedRegressionPredicate, trace)
      ) {
        return true;
      }
    }

    return false;
  }

  private buildForgedScenarios(
    packet: ScenarioPacket,
    baseScenarioId: string,
    failureClass: string
  ): ForgedScenario[] {
    const forged = forgeScenariosFromFailureClass(packet, baseScenarioId, failureClass);
    return forged.map(({ scenarioId, packet: forgedPacket, meta }) => ({
      scenarioId,
      packet: forgedPacket,
      mutation: this.metaToMutation(meta, baseScenarioId),
    }));
  }

  private metaToMutation(
    meta: {
      mutationId: string;
      baseScenarioId: string;
      mutator: string;
      label: string;
      difficultyScore: number;
    },
    baseScenarioId: string
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
      adversarialSignals: [],
      expectedInvariantChecks: [
        "fact-provenance",
        "grounding-citation",
        "attribution-discipline",
      ],
      difficultyScore: meta.difficultyScore,
      synthetic: true,
    };
  }

  private async resolveForgedScenario(
    fossil: DoctrineFossil,
    scenarioId: string
  ): Promise<ForgedScenario | undefined> {
    const fixture = POLICY_SHADOW_FIXTURES.find((f) => f.id === fossil.scenarioRef);
    if (!fixture) return undefined;

    const forged = this.buildForgedScenarios(
      fixture.packet,
      fossil.scenarioRef,
      fossil.failureClass
    );
    return forged.find((f) => f.scenarioId === scenarioId);
  }

  /** Conservative monitoring-only interpretation for forged scenario replay. */
  private conservativeInterpretation(packet: ScenarioPacket): LLMInterpretation {
    const factId = packet.observedFacts[0]?.id ?? "fact_unknown";
    return {
      observedFactsUsed: [factId],
      inferences: [
        {
          claim: "Activity may indicate increased monitoring requirement",
          supportingFacts: [factId],
          confidence: "medium",
          whyNotHigher: "Synthetic or conflicting scenario — insufficient corroboration",
        },
      ],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [
        "Source reliability under synthetic forge conditions — scenario may include injected ambiguity",
      ],
      candidateActions: [
        {
          id: "act_monitor",
          description: "Increase passive monitoring pending corroboration",
          rationale: "Conservative response under forged scenario replay",
          actionType: "observe",
          citedFacts: [factId],
          citedInferences: [],
          confidence: "medium",
        },
      ],
    };
  }
}

export { formatPassportSummary };
