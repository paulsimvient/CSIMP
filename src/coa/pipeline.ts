import { EMPTY_DISPLAYED_PLAN, EMPTY_LOGISTICS_NOT_BUILT } from "./logisticsConstants";
import { assertPipelineInputSchema } from "../schemas";
import { detectEvidenceConflicts } from "../intel/evidence";
import { assertCoaState } from "./assertions";
import { solverResultToConstraintTrace } from "./constraintTrace";
import { applyDominanceFlags } from "./dominance";
import {
  applyEffectsToCandidates,
  computeOverallScore,
  defaultEffectsEngine,
} from "./effects";
import { createRunId, createStableCoaId } from "./ids";
import { buildLogisticsPlan, scoreLogisticsPlan } from "./logistics";
import { buildRankingExplanation } from "./rankRationale";
import { rankCoas } from "./ranking";
import {
  applyIntelFidelityScoring,
  deriveIntelScoringContext,
} from "./intelFidelityScoring";
import { analyzeRankingSensitivity } from "./sensitivity";
import { SOLVER_VERSION, stubSolver } from "./solver";
import type {
  CoaCandidate,
  CoaRunMetadata,
  CoaState,
  EffectsEngineFn,
  LogisticsPlan,
  PipelineInput,
  Signal,
  SolverCandidateResult,
  SolverFn,
} from "./types";

export const SCORING_MODEL_VERSION = "1.0.0";
export const CONSTRAINTS_VERSION = "1.0.0";

// ─── Pipeline dependencies (injectable for testing) ───────────────────────────

type PipelineDeps = {
  solver?: SolverFn;
  effectsEngine?: EffectsEngineFn;
  collectSignals?: (input: PipelineInput) => Signal[];
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * The single entry point for generating a complete CoaState.
 *
 * This function is the ONLY place that creates CoaCandidate objects.
 * Every step runs to completion before state is committed.
 * The caller receives one complete, validated CoaState — no partial updates.
 *
 * Pipeline steps (serial, no intermediate state commits):
 *   1. collectSignals          — cited validated intel actions → signals
 *   2. solver                  — feasible COA candidates (sat/unsat/error)
 *   3. buildLogisticsPlan      — per-candidate logistics (no global trail)
 *   4. effectsEngine           — cyber emulation adapter (simulated) + scoring, by coaId
 *   5. applyIntelFidelityScoring — adjust scores from grounded intel context
 *   6. rankCoas                — SAT first, score, parsimony tie-break
 *   7. return                  — one atomic CoaState for the store to commit
 *   8. assertCoaState          — verify invariants in development
 *
 * See COA_PIPELINE.md for the full design contract.
 *
 * Nothing outside this function may write CoaCandidate objects.
 * Effects results that reference unknown candidate IDs are silently dropped.
 */
export async function runCoaPipeline(
  input: PipelineInput,
  deps: PipelineDeps = {}
): Promise<CoaState> {
  assertPipelineInputSchema(input);
  const solver = deps.solver ?? stubSolver;
  const effectsEngine = deps.effectsEngine ?? defaultEffectsEngine;
  const collectSignals = deps.collectSignals ?? defaultCollectSignals;
  const mode = input.mode;
  if (mode !== "validated-intel" && mode !== "demo") {
    throw new Error("Pipeline mode must be explicitly set: validated-intel or demo");
  }

  const runId = createRunId("run");
  const intelActions = filterCitedIntelActions(input.intelActions ?? []);
  const groundedInput: PipelineInput = { ...input, intelActions };

  // Step 1 — collect signals
  const signals = collectSignals(groundedInput);

  // Step 2 — solve
  let solverResults: SolverCandidateResult[];
  try {
    solverResults = await solver({
      runId,
      signals,
      mode,
      intelActions,
    });
  } catch (err) {
    return errorState(runId, err);
  }

  // Step 3 — build logistics plans and initial candidates
  const candidates: CoaCandidate[] = solverResults.map((result, index) => {
    const id = createStableCoaId(runId, result.selectedActions);
    const label = `COA ${index + 1}`;

    const logisticsPlan =
      result.status === "sat" && result.selectedActions.length > 0
        ? buildLogisticsPlan({
            coaId: id,
            actions: result.selectedActions,
            source: mode === "validated-intel" ? "validated-intel" : "demo",
            intelActions: groundedInput.intelActions,
            observedFacts: groundedInput.observedFacts,
          })
        : result.status === "unsat"
          ? { kind: "empty" as const, reason: "unsat" as const }
          : { kind: "empty" as const, reason: "no-actions" as const };

    const logisticsScore = scoreLogisticsPlan(logisticsPlan);
    const feasibility =
      result.status === "sat"
        ? 1
        : result.status === "insufficient_evidence"
          ? 0.35
          : 0;

    const candidate: CoaCandidate = {
      id,
      runId,
      origin: "automated",
      revisionId: `rev-${id}`,
      validationStatus: "validated",
      status: result.status,
      label,
      selectedActions: result.selectedActions,
      logisticsPlan,
      constraintTrace: solverResultToConstraintTrace(result),
      scores: {
        feasibility,
        logistics: logisticsScore,
        effects: 0,
        risk: 0,
        overall: computeOverallScore(feasibility, logisticsScore, 0, 0),
      },
    };
    return candidate;
  });

  // Step 4 — effects analysis
  // Effects annotate existing candidates by ID. They cannot create new IDs
  // or modify logisticsPlan / selectedActions.
  let enrichedCandidates: CoaCandidate[];
  try {
    const effectsByCoaId = await effectsEngine(candidates, {
      intelActions: groundedInput.intelActions,
      cyberEmulation: groundedInput.cyberEmulation,
    });

    // Drop any effects results that reference unknown candidate IDs
    const knownIds = new Set(candidates.map((c) => c.id));
    const validEffects: Record<string, import("./types").EffectsResult> =
      Object.fromEntries(
        Object.entries(effectsByCoaId).filter(([id]) => knownIds.has(id))
      );

    enrichedCandidates = applyEffectsToCandidates(candidates, validEffects);
  } catch (err) {
    // Effects failure is non-fatal: degrade gracefully with pre-effects scores
    console.warn("[COA pipeline] Effects engine failed — proceeding without effects.", err);
    enrichedCandidates = candidates;
  }

  // Step 5 — rank
  const fidelityAdjusted = applyIntelFidelityScoring(
    enrichedCandidates,
    deriveIntelScoringContext({ intelActions: groundedInput.intelActions })
  );
  const withDominance = applyDominanceFlags(fidelityAdjusted);
  const ranked = rankCoas(withDominance).map((candidate, index) => ({
    ...candidate,
    rankingExplanation: buildRankingExplanation(candidate, index + 1),
  }));

  const evidenceConflicts = input.observedFacts
    ? detectEvidenceConflicts(input.observedFacts)
    : [];

  const rankingSensitivity = analyzeRankingSensitivity(ranked);

  const cyberProvider = input.cyberEmulation?.provider;
  const runMetadata: CoaRunMetadata = {
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    constraintsVersion: CONSTRAINTS_VERSION,
    scoringVersion: SCORING_MODEL_VERSION,
    solverVersion: SOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    ...(cyberProvider
      ? {
          cyberEmulationProvider: cyberProvider,
          ...(cyberProvider === "simulated"
            ? { cyberEmulationExecutionMode: "simulation" as const }
            : {}),
        }
      : {}),
  };

  // Step 6 — assemble final state (prefer a SAT COA that has a populated logistics plan)
  const defaultSelected = pickDefaultSelectedCoa(ranked);
  const finalState: CoaState = {
    activeRunId: runId,
    candidatesById: Object.fromEntries(ranked.map((c) => [c.id, c])),
    candidateOrder: ranked.map((c) => c.id),
    ...(defaultSelected ? { selectedCoaId: defaultSelected.id } : {}),
    status: "ready",
    runMetadata,
    evidenceConflicts,
    rankingSensitivity,
  };

  // Step 7 — assert invariants (dev only)
  assertCoaState(finalState);

  return finalState;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Prefer a feasible COA whose logistics plan can populate the matrix. */
export function pickDefaultSelectedCoa(
  ranked: CoaCandidate[]
): CoaCandidate | undefined {
  const automated = ranked.filter((c) => (c.origin ?? "automated") === "automated");
  return (
    automated.find(
      (c) =>
        c.status === "sat" &&
        !c.dominatedBy &&
        c.logisticsPlan.kind === "populated"
    ) ??
    automated.find(
      (c) => c.status === "sat" && c.logisticsPlan.kind === "populated"
    ) ??
    automated.find((c) => c.status === "sat") ??
    automated.find((c) => c.status === "insufficient_evidence") ??
    automated[0]
  );
}

/**
 * Logistics matrix reads this — not a separate global plan.
 */
export function resolveDisplayedLogisticsPlan(
  state: CoaState
): LogisticsPlan | { kind: "empty"; reason: "no-coa-selected" | "not-built" | "unsat" | "no-actions" } {
  if (state.status === "running") {
    return EMPTY_LOGISTICS_NOT_BUILT;
  }

  const ranked = selectRankedCandidates(state);
  if (ranked.length === 0) {
    return EMPTY_DISPLAYED_PLAN;
  }

  if (state.selectedCoaId) {
    const selected = state.candidatesById[state.selectedCoaId];
    if (selected) return selected.logisticsPlan;
  }

  const fallback = pickDefaultSelectedCoa(ranked);
  if (fallback?.logisticsPlan.kind === "populated") {
    return fallback.logisticsPlan;
  }

  return fallback?.logisticsPlan ?? EMPTY_DISPLAYED_PLAN;
}

/**
 * Returns the logistics plan to render in the UI.
 *
 * This is the ONLY correct way to get the displayed plan.
 * It derives directly from the selected candidate's logisticsPlan —
 * there is no separate global logistics state to read from.
 */
export function selectDisplayedLogisticsPlan(state: CoaState) {
  return resolveDisplayedLogisticsPlan(state);
}

/**
 * Returns the currently selected COA candidate, or undefined.
 */
export function selectSelectedCoa(state: CoaState): CoaCandidate | undefined {
  return state.selectedCoaId
    ? state.candidatesById[state.selectedCoaId]
    : undefined;
}

/**
 * Returns candidates in ranked order.
 */
export function selectRankedCandidates(state: CoaState): CoaCandidate[] {
  return state.candidateOrder
    .map((id) => state.candidatesById[id])
    .filter((c): c is CoaCandidate => c !== undefined);
}

// ─── Internal utilities ───────────────────────────────────────────────────────

/**
 * Converts pipeline input into Signal[].
 *
 * If the input has intelActions (from the intel layer), each validated action
 * becomes a signal carrying its description and cited fact IDs. This lets the
 * solver know which domains are relevant without giving it raw LLM text.
 *
 * The intel layer's grounding validator has already ensured every citedFact
 * references a real observed fact before this runs.
 */
/**
 * Intel actions without at least one cited fact ID never enter the COA solver.
 */
export function filterCitedIntelActions(
  actions: NonNullable<PipelineInput["intelActions"]>
): NonNullable<PipelineInput["intelActions"]> {
  return actions.filter(
    (action) =>
      Array.isArray(action.citedFacts) &&
      action.citedFacts.some((id) => typeof id === "string" && id.trim() !== "")
  );
}

function defaultCollectSignals(input: PipelineInput): Signal[] {
  const explicit = input.signals ?? [];

  const intelSignals: Signal[] = filterCitedIntelActions(input.intelActions ?? []).map((action) => ({
    id: `signal-intel-${action.id}`,
    type: "intel-validated-action",
    value: {
      actionDescription: action.description,
      citedFacts: action.citedFacts,
      actionType: action.actionType,
      requiredAssets: action.requiredAssets ?? [],
      timeSensitivity: action.timeSensitivity,
      confidence: action.confidence,
    },
    timestamp: Date.now(),
    factId: action.citedFacts[0],
  }));

  return [...explicit, ...intelSignals];
}

function errorState(runId: string, err: unknown): CoaState {
  const message = err instanceof Error ? err.message : String(err);
  return {
    activeRunId: runId,
    candidatesById: {},
    candidateOrder: [],
    status: "error",
    error: message,
  };
}

